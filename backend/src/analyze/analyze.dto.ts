import { IsString, IsNotEmpty } from 'class-validator';

export class AnalyzeDto {
  @IsString()
  @IsNotEmpty()
  market: string;

  @IsString()
  @IsNotEmpty()
  coinId: string;
}
