import { config } from '../../config.js';
import { RazorpayProvider } from './razorpay.js';
import { SimulatedProvider } from './simulated.js';
import type { PaymentProvider, ProviderName } from './types.js';

const providers: Record<ProviderName, PaymentProvider> = {
  simulated: new SimulatedProvider(),
  razorpay: new RazorpayProvider(),
};

export function activeProvider(): PaymentProvider {
  return providers[config.payment.provider] ?? providers.simulated;
}

export function providerByName(name: string): PaymentProvider | null {
  return (providers as Record<string, PaymentProvider>)[name] ?? null;
}
