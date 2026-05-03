import { Controller, MessageEvent, Param, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SseService } from './sse.service';

@Controller('events')
export class SseController {
  constructor(private readonly sseService: SseService) {}

  // GET /events/:userId — browser connects here to receive real-time results.
  @Sse(':userId')
  stream(@Param('userId') userId: string): Observable<MessageEvent> {
    return this.sseService.subscribe(userId);
  }
}
