import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { DigestService } from './digest.service';

@Module({
  imports: [AiModule],
  providers: [DigestService],
  exports: [DigestService],
})
export class DigestModule {}
