import { useEffect, useState } from 'react';
import { api } from '../services/api.js';

export function useBackendHealth(refresh) {
  const [health, setHealth] = useState('checking');

  useEffect(() => {
    const controller = new AbortController();
    setHealth('checking');
    api.health({ signal: controller.signal })
      .then(() => { if (!controller.signal.aborted) setHealth('connected'); })
      .catch(() => { if (!controller.signal.aborted) setHealth('unavailable'); });
    return () => controller.abort();
  }, [refresh]);

  return health;
}
