import { Injectable } from '@nestjs/common';

@Injectable()
export class PaymentGatewayService {
  // TODO: replace with a real payment gateway integration (e.g. Stripe).
  //
  // Current behaviour: simulates an 80 % success rate via Math.random().
  // All tests mock this method directly so the non-determinism never leaks
  // into the test suite.
  //
  // When integrating a real gateway:
  //   1. Inject ConfigService and read the API key from env (PAYMENT_API_KEY).
  //   2. Replace the random return with the actual charge call.
  //   3. Consider making the simulated success rate configurable via
  //      PAYMENT_MOCK_SUCCESS_RATE env var for local dev / load testing.
  async charge(_userId: string): Promise<boolean> {
    return Math.random() < 0.8;
  }
}
