import { IsString, IsNumber, IsNotEmpty, IsPositive, IsOptional, IsIn, Min, Max } from 'class-validator';

export class RunBacktestDto {
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @IsString()
  @IsNotEmpty()
  interval: string;

  @IsNumber()
  @IsPositive()
  days: number;

  @IsNumber()
  @IsPositive()
  initialBalance: number;

  @IsNumber()
  @IsPositive()
  @Min(0.1)
  atrMultiplier: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(9)
  confluenceThreshold?: number;

  @IsOptional()
  @IsIn(['BUY', 'SELL', 'BOTH'])
  direction?: 'BUY' | 'SELL' | 'BOTH';
}
