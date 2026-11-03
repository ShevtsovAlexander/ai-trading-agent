import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { AiService } from '../ai/ai.service';
import { Interval, MarketView } from './market.types';

// Сколько /market/view ждёт комментарий (TASK-0013): цена и индикаторы не
// должны стоять за моделью. Не успела — null (фронт: «комментарий не готов»),
// а не комментарий прошлой свечи: подписи свечи у него нет, числа разошлись
// бы с карточкой (критик T3). Генерация доходит в фоне и пишет кэш —
// следующий опрос получит её.
export const VIEW_COMMENT_WAIT_MS = 3000;

const INTERVAL_LABEL: Record<Interval, string> = {
  '1m': '1 минута',
  '5m': '5 минут',
  '15m': '15 минут',
  '1h': '1 час',
  '4h': '4 часа',
  '1d': '1 день',
};

@Injectable()
export class MarketComment {
  private readonly logger = new Logger(MarketComment.name);

  // Кэш по монете и интервалу (ключ `coinId|interval`): факты не
  // изменились → не гоняем Groq.
  // Хеш считается от тех же полей, что уходят в промпт — иначе кэш
  // промахивался бы на изменениях, которых модель всё равно не видит.
  private readonly cache = new Map<string, { hash: string; comment: string }>();
  // Генерация в полёте по `ключ|хеш фактов`: опрос, пока модель думает, не
  // запускает второй вызов на те же факты
  private readonly inflight = new Map<
    string,
    { job: Promise<string | null>; started: number }
  >();

  private static readonly SYSTEM =
    'Ты крипто-аналитик. Описываешь обстановку на рынке по показаниям ' +
    'приборов, на русском, 2-3 предложения. ' +
    // Рамка проекта: «триггеры, не команды». Решение принимает человек,
    // работа модели — назвать, что происходит, и не более.
    'НЕ давай рекомендаций и НЕ предлагай действий: ни «купить», ни ' +
    '«продать», ни «вход», ни «стоп», ни «стоит»/«не стоит». ' +
    'Только описание: что показывают индикаторы и что это значит про ' +
    'состояние рынка. ' +
    // gpt-oss — reasoning-модель: без явного запрета вписывает ход мыслей
    // в ответ (тот же приём, что в DigestService.SYSTEM).
    'Отвечай только готовым текстом, без рассуждений, пояснений и ' +
    'вводных фраз. Обычный текст без markdown-разметки ' +
    '(без **, ##, списков со звёздочками).';

  // Модель видит 5 последних закрытых свечей — динамику
  // дальше она выдумала бы: «рынок растёт неделю» по пяти 5-минутным точкам.
  // Изменения посчитаны кодом: сравнивая числа сама, модель путала порядок
  // и знак (−530 → −400 называла «снижением», критик T5).
  private static readonly SYSTEM_VIEW =
    MarketComment.SYSTEM +
    ' Динамику (растёт, падает, разворачивается, ускоряется) описывай ' +
    'только по приведённым данным: значениям последних свечей, их ' +
    'посчитанным изменениям. Изменения уже ' +
    'посчитаны — опирайся на них, не пересчитывай. Не утверждай ничего о ' +
    'периоде длиннее и о том, чего нет в данных.';

  constructor(private readonly ai: AiService) {}

  // Комментарий к последней закрытой свече интервала: в промпте интервал и
  // 5 последних значений, чтобы динамика бралась из данных, а не из догадок.
  describeView(view: MarketView): Promise<string | null> {
    const key = `${view.coinId}|${view.interval}`;
    let flightKey: string;
    try {
      flightKey = `${key}|${this.hashView(view)}`;
    } catch {
      flightKey = key; // сбой хеша разберёт generate под try
    }
    // Генерация над этими фактами уже идёт — ждём остаток ТОГО ЖЕ окна (две
    // вкладки, двойной вызов StrictMode получат ответ быстрой модели), а
    // после окна — null сразу: повисшая модель не держит каждый опрос по 3 с
    // (критик T5)
    const running = this.inflight.get(flightKey);
    if (running) {
      const left = running.started + VIEW_COMMENT_WAIT_MS - Date.now();
      return left > 0
        ? this.withinWait(running.job, key, left)
        : Promise.resolve(null);
    }
    const job = this.generate(
      key,
      () => this.hashView(view),
      () => this.buildViewPrompt(view),
      MarketComment.SYSTEM_VIEW,
    ).finally(() => this.inflight.delete(flightKey));
    this.inflight.set(flightKey, { job, started: Date.now() });
    return this.withinWait(job, key, VIEW_COMMENT_WAIT_MS);
  }

  // Ждём генерацию не дольше VIEW_COMMENT_WAIT_MS; таймер снимается, когда
  // генерация успела (иначе висел бы в процессе)
  private withinWait(
    job: Promise<string | null>,
    key: string,
    waitMs: number,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.logger.warn(
          `Комментарий ${key}: модель не ответила за ${VIEW_COMMENT_WAIT_MS} мс — null, генерация в фоне`,
        );
        resolve(null);
      }, waitMs);
      job.then(
        (comment) => {
          clearTimeout(timer);
          resolve(comment);
        },
        () => {
          clearTimeout(timer);
          resolve(null); // generate не бросает; на случай правки — не unhandled
        },
      );
    });
  }

  // Весь метод под try: отказ AI-слоя не должен ронять маршрут данных.
  // hash и prompt — функции, чтобы и их сбой попадал под try.
  private async generate(
    key: string,
    hash: () => string,
    prompt: () => string,
    system: string,
  ): Promise<string | null> {
    let cached: { hash: string; comment: string } | undefined;

    try {
      cached = this.cache.get(key);
      const facts = hash();
      if (cached?.hash === facts) return cached.comment; // факты те же

      const comment = (
        await this.ai.complete(prompt(), {
          system,
          maxTokens: 300,
          temperature: 0.3,
        })
      ).trim();

      // Модель молчит → прошлый комментарий, а не пустая карточка
      if (!comment) return cached?.comment ?? null;

      this.cache.set(key, { hash: facts, comment });
      return comment;
    } catch (e) {
      this.logger.warn(`Комментарий не сгенерён (${key}): ${String(e)}`);
      return cached?.comment ?? null; // fallback на прошлый
    }
  }

  // По строке на индикатор: ряд слева направо от старой свечи к последней
  // и изменение за окно, посчитанное здесь, а не моделью
  private buildViewPrompt(v: MarketView): string {
    const r = v.recent;
    const row = (label: string, values: (number | null)[]) =>
      `${label}: ${values.map((x) => this.fmt(x)).join(' → ')}` +
      ` (за ${r.length} свечей: ${this.change(values[0], values[values.length - 1])})`;
    const cross = r
      .map((p) =>
        p.ema9 === null || p.ema21 === null
          ? 'нет данных'
          : p.ema9 > p.ema21
            ? 'выше'
            : p.ema9 < p.ema21
              ? 'ниже'
              : 'равна',
      )
      .join(' → ');

    return `Опиши обстановку на рынке ${v.market}, свечи ${INTERVAL_LABEL[v.interval]}.

Последние ${r.length} закрытых свечей, значения слева направо — от самой старой к последней:
${row(
  'Цена, $',
  r.map((p) => p.close),
)}
${row(
  'RSI',
  r.map((p) => p.rsi),
)}
${row(
  'EMA9',
  r.map((p) => p.ema9),
)}
${row(
  'EMA21',
  r.map((p) => p.ema21),
)}
EMA9 относительно EMA21: ${cross}
${row(
  'MACD histogram',
  r.map((p) => p.macdHistogram),
)}
${row(
  'Ширина полос Боллинджера, %',
  r.map((p) => p.bbBandwidth),
)}`;
  }

  // Изменение от первой к последней: знак разности, а не «к нулю/от нуля» —
  // −530 → −400 это рост на 130
  private change(first: number | null, last: number | null): string {
    if (first === null || last === null) return 'нет данных';
    const diff = parseFloat((last - first).toFixed(2));
    if (diff > 0) return `рост на ${diff}`;
    if (diff < 0) return `снижение на ${-diff}`;
    return 'без изменений';
  }

  // Значения ряда nullable: периоду индикатора не хватило свечей
  private fmt(value: number | null): string {
    return value === null ? 'нет данных' : String(value);
  }

  // Те же факты, что в buildViewPrompt
  private hashView(v: MarketView): string {
    const facts = [
      v.market,
      v.interval,
      v.price,
      ...v.recent.flatMap((p) => [
        p.close,
        p.rsi,
        p.ema9,
        p.ema21,
        p.macdHistogram,
        p.bbBandwidth,
      ]),
    ].join('|');
    return createHash('sha1').update(facts).digest('hex');
  }
}
