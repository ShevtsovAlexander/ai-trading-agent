import { Controller, Get } from '@nestjs/common';
import { DigestService } from '../digest/digest.service';
import { Digest } from '../digest/digest.types';
import { NewsService } from './news.service';
import { NewsItem } from './news.types';

@Controller('news')
export class NewsController {
  constructor(
    private readonly newsService: NewsService,
    private readonly digest: DigestService,
  ) {}

  @Get()
  getNews(): NewsItem[] {
    return this.newsService.getNews();
  }

  @Get('digest')
  getDigest(): Digest | null {
    return this.digest.getDigest();
  }
}
