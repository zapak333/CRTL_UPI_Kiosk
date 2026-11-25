import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { fileParallelism: false, testTimeout: 20000, hookTimeout: 30000, env: { NODE_ENV: 'test', PAYMENT_PROVIDER: 'simulated', RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', RAZORPAY_WEBHOOK_SECRET: '' } },
});
