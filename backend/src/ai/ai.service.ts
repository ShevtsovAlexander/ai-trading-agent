import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';

@Injectable()
export class AiService {
  private groq: Groq;

  constructor(private configService: ConfigService) {
    this.groq = new Groq({
      apiKey: this.configService.get<string>('GROQ_API_KEY'),
    });
  }

  async analyze(
    market: string,
    currentPrice: number,
    decision: string,
    reason: string,
    trend: string,
  ): Promise<string> {
    const chat = await this.groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `Ты — AI trading agent. Анализируешь крипторынок.
Отвечай коротко, 2-3 предложения. Только на русском.
Формат: оценка ситуации + совет по риску.`,
        },
        {
          role: 'user',
          content: `Рынок: ${market}
Текущая цена: $${currentPrice}
Тренд: ${trend}
Решение системы: ${decision}
Причина: ${reason}

Дай краткий анализ и оценку риска.`,
        },
      ],
      max_completion_tokens: 200,
    });

    return chat.choices[0].message.content ?? 'Анализ недоступен';
  }

  // Универсальный one-shot вызов модели — для задач вне торгового анализа
  // (перевод новостей и т.п.). Возвращает пустую строку, если модель молчит.
  async complete(
    prompt: string,
    opts: { system?: string; maxTokens?: number; temperature?: number } = {},
  ): Promise<string> {
    const messages: Groq.Chat.ChatCompletionMessageParam[] = [];
    if (opts.system) {
      messages.push({ role: 'system', content: opts.system });
    }
    messages.push({ role: 'user', content: prompt });

    const chat = await this.groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_completion_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature,
    });

    return chat.choices[0].message.content ?? '';
  }
}
