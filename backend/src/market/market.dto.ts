import { IsString, IsNotEmpty } from 'class-validator';

export class MarketDto {
  @IsString()
  @IsNotEmpty()
  market: string;

  @IsString()
  @IsNotEmpty()
  coinId: string;
}
