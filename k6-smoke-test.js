import http from 'k6/http';
import { check, sleep, group } from 'k6';

// Fast smoke test for autoresearch loop measurements
export const options = {
  vus: 10,
  duration: '10s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.TARGET || 'http://localhost:8090';

export default function () {
  group('PocketBase API', () => {
    const healthRes = http.get(`${BASE_URL}/api/health`);
    check(healthRes, {
      'health returns 200': (r) => r.status === 200,
    });

    const relaysRes = http.get(`${BASE_URL}/api/collections/relays/records`);
    check(relaysRes, {
      'relays list returns 2xx': (r) => r.status >= 200 && r.status < 300,
    });

    const foldersRes = http.get(`${BASE_URL}/api/collections/shared_folders/records`);
    check(foldersRes, {
      'folders list returns 2xx': (r) => r.status >= 200 && r.status < 300,
    });
  });

  sleep(0.1);
}
