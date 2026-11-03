/**
 * AiService (TASK-0013): клиент Groq получает таймаут и повторы из конфига,
 * а не умолчания groq-sdk (60 с × 3 попытки).
 */
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import { AiService } from './ai.service';

jest.mock('groq-sdk');
const GroqMock = Groq as unknown as jest.Mock;

const make = (env: Record<string, string | undefined>) => {
  GroqMock.mockClear();
  new AiService({ get: (k: string) => env[k] } as unknown as ConfigService);
  return (GroqMock.mock.calls as unknown[][])[0][0] as {
    apiKey: string;
    timeout: number;
    maxRetries: number;
  };
};

describe('AiService — клиент Groq', () => {
  it('без настроек — 20 с и 1 повтор', () => {
    expect(make({ GROQ_API_KEY: 'k' })).toEqual({
      apiKey: 'k',
      timeout: 20_000,
      maxRetries: 1,
    });
  });

  it('из конфига — как задано (0 повторов допустимо)', () => {
    expect(
      make({
        GROQ_API_KEY: 'k',
        GROQ_TIMEOUT_MS: '5000',
        GROQ_MAX_RETRIES: '0',
      }),
    ).toMatchObject({ timeout: 5000, maxRetries: 0 });
  });

  it('мусор и пустая строка — значения по умолчанию', () => {
    expect(
      make({ GROQ_TIMEOUT_MS: 'abc', GROQ_MAX_RETRIES: '' }),
    ).toMatchObject({ timeout: 20_000, maxRetries: 1 });
    expect(make({ GROQ_TIMEOUT_MS: '-1' })).toMatchObject({ timeout: 20_000 });
    expect(make({ GROQ_TIMEOUT_MS: '0' })).toMatchObject({ timeout: 20_000 });
  });

  it('complete: свой таймаут вызова передаётся вторым аргументом, без него — нет', async () => {
    GroqMock.mockClear();
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'ок' } }],
    });
    GroqMock.mockImplementation(() => ({ chat: { completions: { create } } }));
    const ai = new AiService({
      get: () => undefined,
    } as unknown as ConfigService);
    await ai.complete('p', { timeoutMs: 60_000 });
    await ai.complete('p');
    expect((create.mock.calls as unknown[][])[0][1]).toEqual({
      timeout: 60_000,
    });
    expect((create.mock.calls as unknown[][])[1][1]).toBeUndefined();
    GroqMock.mockReset();
  });
});
