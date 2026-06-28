import { Body, Controller, Post } from '@nestjs/common';
import { BacktestService } from './backtest.service';
import { RunBacktestDto } from './backtest.dto';

@Controller('backtest')
export class BacktestController {
  constructor(private readonly backtestService: BacktestService) {}

  @Post('run')
  run(@Body() dto: RunBacktestDto) {
    return this.backtestService.run(dto);
  }
}
