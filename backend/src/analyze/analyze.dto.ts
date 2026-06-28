import {
  IsString,
  IsNumber,
  IsOptional,
  Min,
  IsNotEmpty,
} from 'class-validator';

export class AnalyzeDto {
  @IsString()
  @IsNotEmpty()
  market: string;

  @IsString()
  @IsNotEmpty()
  coinId: string;

  @IsNumber()
  @Min(0)
  volume: number;
}
