import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DerivativesController } from './derivatives.controller';
import { DerivativesService } from './derivatives.service';

@Module({
  imports: [HttpModule],
  providers: [DerivativesService],
  controllers: [DerivativesController],
})
export class DerivativesModule {}
