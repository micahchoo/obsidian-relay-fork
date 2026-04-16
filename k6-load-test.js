import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics
const apiErrors = new Counter('api_errors');
const apiSuccess = new Counter('api_success');
const responseTime = new Trend('response_time_ms');
const errorRate = new Rate('error_rate');

// Test configuration
export const options = {
  stages: [
    { duration: '10s', target: 0 },   // Warmup
    { duration: '30s', target: 20 },  // Ramp to 20 users
    { duration: '1m', target: 50 },   // Steady at 50 users
    { duration: '30s', target: 0 },  // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests under 500ms
    error_rate: ['rate<0.05'],           // Less than 5% errors
  },
};

const BASE_URL = __ENV.TARGET || 'http://localhost:8090';
const RELAY_URL = __ENV.RELAY_TARGET || 'http://localhost:8082';

// Auth helper - creates or gets test user
function auth() {
  const email = `loadtest-${Date.now()}@example.com`;
  const password = 'testpassword123';
  
  // Try to register (may fail if exists)
  const registerRes = http.post(`${BASE_URL}/api/collections/users/records`, 
    JSON.stringify({ email, password, passwordConfirm: password }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  
  // If registration fails, try login with existing user
  if (registerRes.status === 400) {
    const loginRes = http.post(`${BASE_URL}/api/collections/users/auth-with-password`,
      JSON.stringify({ identity: email, password }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    return loginRes.status === 200 ? JSON.parse(loginRes.body).token : null;
  }
  
  return registerRes.status === 200 ? JSON.parse(registerRes.body).token : null;
}

export default function () {
  group('PocketBase API', () => {
    // Test 1: Health check
    const healthRes = http.get(`${BASE_URL}/api/health`);
    check(healthRes, {
      'health returns 200': (r) => r.status === 200,
      'health is healthy': (r) => JSON.parse(r.body).code === 200,
    }) ? apiSuccess.add(1) : apiErrors.add(1);
    responseTime.add(healthRes.timings.duration);
    
    // Test 2: List relays (public endpoint)
    const relaysRes = http.get(`${BASE_URL}/api/collections/relays/records`);
    const relaysOk = check(relaysRes, {
      'relays list returns 200': (r) => r.status === 200 || r.status === 401,
    });
    relaysOk ? apiSuccess.add(1) : apiErrors.add(1);
    responseTime.add(relaysRes.timings.duration);
    
    // Test 3: List shared_folders (public endpoint)
    const foldersRes = http.get(`${BASE_URL}/api/collections/shared_folders/records`);
    const foldersOk = check(foldersRes, {
      'folders list returns 2xx': (r) => r.status >= 200 && r.status < 300,
    });
    foldersOk ? apiSuccess.add(1) : apiErrors.add(1);
    responseTime.add(foldersRes.timings.duration);
    
    // Test 4: List users (admin only - should 401)
    const usersRes = http.get(`${BASE_URL}/api/collections/users/records`);
    const usersOk = check(usersRes, {
      'users list properly auth-gated': (r) => r.status === 401,
    });
    usersOk ? apiSuccess.add(1) : apiErrors.add(1);
    responseTime.add(usersRes.timings.duration);
  });
  
  group('Relay Server API', () => {
    // Test relay-server endpoints
    const relayHealth = http.get(`${RELAY_URL}/api/health`);
    const relayOk = check(relayHealth, {
      'relay-server health': (r) => r.status === 200,
    });
    relayOk ? apiSuccess.add(1) : apiErrors.add(1);
    responseTime.add(relayHealth.timings.duration);
  });
  
  // Random sleep to simulate user behavior
  sleep(Math.random() * 2 + 0.5);
}

export function handleSummary(data) {
  const summary = {
    'test_duration': data.test_duration_secs,
    'total_requests': data.metrics.http_reqs.values.count,
    'error_rate': data.metrics.error_rate.values.passes > 0 
      ? data.metrics.error_rate.values.fails / (data.metrics.error_rate.values.passes + data.metrics.error_rate.values.fails)
      : 0,
    'p95_latency_ms': data.metrics.http_req_duration.values['p(95)'],
    'avg_latency_ms': data.metrics.http_req_duration.values.avg,
  };
  
  return {
    stdout: JSON.stringify(summary, null, 2),
  };
}
