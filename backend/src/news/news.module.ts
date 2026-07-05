import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { DigestModule } from '../digest/digest.module';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';
import { NewsTranslator } from './news.translator';

@Module({
  imports: [AiModule, DigestModule],
  controllers: [NewsController],
  providers: [NewsService, NewsTranslator],
})
export class NewsModule {}
