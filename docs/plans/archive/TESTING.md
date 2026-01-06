## Running Tests
To run the test suite for the API, navigate to the `apps/api` directory and use the following commands:

```bash
cd apps/api

# Run all tests
npm run test

# Watch mode
npm run test:watch

# With coverage report
npm run test:coverage

# E2E tests against live server
TEST_API_URL=https://192.168.1.201:3443 npm run test:e2e