import { Controller, Post, Body, Get, Param, Query } from '@nestjs/common';
import { AnalyzeService } from './analyze.service';
import { AnalyzeDto } from './analyze.dto';

@Controller('analyze')
export class AnalyzeController {
  constructor(private analyzeService: AnalyzeService) {}

  @Post()
  async analyze(@Body() body: AnalyzeDto) {
    return this.analyzeService.analyze(body);
  }

  @Get('decisions/:coinId')
  getDecisions(
    @Param('coinId') coinId: string,
    @Query('limit') limit?: string,
  ) {
    return this.analyzeService.getDecisions(
      coinId,
      limit ? parseInt(limit) : 50,
    );
  }
}
