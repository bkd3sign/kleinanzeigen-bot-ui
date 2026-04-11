'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useLogStream() {
  const [lines, setLines] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    // Close existing connection first
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const token = localStorage.getItem('token');
    if (!token) return;

    setIsConnected(true);

    const es = new EventSource(`/api/logs/stream?token=${encodeURIComponent(token)}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      if (event.data) {
        setLines((prev) => [...prev.slice(-4999), event.data]);
      }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      // Keep isConnected true briefly so user sees the state, then reset
      setTimeout(() => setIsConnected(false), 1000);
    };
  }, []);

  const disconnect = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setIsConnected(false);
  }, []);

  const clear = useCallback(() => setLines([]), []);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  return { lines, isConnected, connect, disconnect, clear };
}
