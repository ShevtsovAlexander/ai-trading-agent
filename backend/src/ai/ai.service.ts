import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';

// Значения reasoning_effort, которые принимает Groq (см. groq-sdk)
type ReasoningEffort = 'none' | 'default' | 'low' | 'medium' | 'high';

@Injectable()
export class AiService {
  private groq: Groq;
  // Groq регулярно декоммиссит модели — держим id в конфиге, а не в коде
  private readonly model: string;

  // У reasoning-моделей (gpt-oss) размышления списываются из того же
  // max_completion_tokens, что и ответ: на дефолтном effort они съедали
  // весь бюджет дайджеста (400) и обрезали батч перевода. 'low' возвращает
  // лимитам смысл «бюджет на ответ». 'off' — не слать параметр вовсе,
  // для моделей без reasoning (llama и т.п.).
  private readonly reasoningEffort?: ReasoningEffort;

  constructor(private configService: ConfigService) {
    // Таймаут и повторы клиента — конфигом (TASK-0013): по умолчанию у
    // groq-sdk 60 с и 2 повтора — повисшая модель держала вызов до ≈ 3 мин
    this.groq = new Groq({
      apiKey: this.configService.get<string>('GROQ_API_KEY'),
      timeout: this.numberFrom('GROQ_TIMEOUT_MS', 20_000, 1),
      maxRetries: this.numberFrom('GROQ_MAX_RETRIES', 1, 0),
    });
    this.model =
      this.configService.get<string>('GROQ_MODEL') ?? 'openai/gpt-oss-120b';

    const effort =
      this.configService.get<string>('GROQ_REASONING_EFFORT') ?? 'low';
    this.reasoningEffort =
      effort === 'off' ? undefined : (effort as ReasoningEffort);
  }

  // Число из конфига не меньше min; пусто или мусор — значение по умолчанию
  // (таймаут 0 оборвал бы каждый вызов — критик T5)
  private numberFrom(key: string, fallback: number, min: number): number {
    const raw = this.configService.get<string>(key);
    const n = Number(raw);
    return raw !== undefined && raw !== '' && Number.isFinite(n) && n >= min
      ? n
      : fallback;
  }

  // Универсальный one-shot вызов модели — перевод новостей, дайджест,
  // комментарий к снимку рынка. Возвращает пустую строку, если модель молчит.
  async complete(
    prompt: string,
    opts: {
      system?: string;
      maxTokens?: number;
      temperature?: number;
      // Свой таймаут вызова поверх клиентского (перевод 50 заголовков дольше)
      timeoutMs?: number;
    } = {},
  ): Promise<string> {
    const messages: Groq.Chat.ChatCompletionMessageParam[] = [];
    if (opts.system) {
      messages.push({ role: 'system', content: opts.system });
    }
    messages.push({ role: 'user', content: prompt });

    const chat = await this.groq.chat.completions.create(
      {
        model: this.model,
        messages,
        max_completion_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature,
        reasoning_effort: this.reasoningEffort,
      },
      opts.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : undefined,
    );

    return chat.choices[0].message.content ?? '';
  }
}
