import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { AiService } from '../ai/ai.service';
import { Interval, MarketView } from './market.types';

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

  // Модель видит 5 последних закрытых свечей и тренд за 10 — динамику
  // дальше она выдумала бы: «рынок растёт неделю» по пяти 5-минутным точкам.
  // Изменения посчитаны кодом: сравнивая числа сама, модель путала порядок
  // и знак (−530 → −400 называла «снижением», критик T5).
  private static readonly SYSTEM_VIEW =
    MarketComment.SYSTEM +
    ' Динамику (растёт, падает, разворачивается, ускоряется) описывай ' +
    'только по приведённым данным: значениям последних свечей, их ' +
    'посчитанным изменениям и тренду за 10 свечей. Изменения уже ' +
    'посчитаны — опирайся на них, не пересчитывай. Не утверждай ничего о ' +
    'периоде длиннее и о том, чего нет в данных.';

  constructor(private readonly ai: AiService) {}

  // Комментарий к последней закрытой свече интервала: в промпте интервал и
  // 5 последних значений, чтобы динамика бралась из данных, а не из догадок.
  describeView(view: MarketView): Promise<string | null> {
    return this.generate(
      `${view.coinId}|${view.interval}`,
      () => this.hashView(view),
      () => this.buildViewPrompt(view),
      MarketComment.SYSTEM_VIEW,
    );
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

Тренд за последние 10 свечей: ${v.trend}

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
      v.trend,
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
