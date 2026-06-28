import { Controller, Get, Param } from '@nestjs/common';
import { PositionService } from './position.service';

@Controller('positions')
export class PositionController {
  constructor(private positionService: PositionService) {}

  // Все позиции или по конкретной монете
  @Get()
  getAllPositions() {
    return this.positionService.getAllPositions();
  }

  @Get(':coinId')
  getPositions(@Param('coinId') coinId: string) {
    return this.positionService.getAllPositions(coinId);
  }

  @Get(':coinId/open')
  getOpenPosition(@Param('coinId') coinId: string) {
    return this.positionService.getOpenPosition(coinId);
  }
}
