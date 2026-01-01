#!/bin/sh
cd apps/api
export TEST_API_URL=https://localhost:3443
export TEST_USERNAME=admin
export TEST_PASSWORD=admin
npx vitest run tests/e2e/api.e2e.test.ts -v
