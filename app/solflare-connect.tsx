import * as Linking from 'expo-linking';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { handleSolflareCallbackUrl } from '@/lib/solflare-callback';

export default function SolflareConnectScreen() {
  const params = useLocalSearchParams();

  useEffect(() => {
    const query = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
      if (typeof value === 'string') {
        query.append(key, value);
      } else if (Array.isArray(value)) {
        value.forEach((item) => query.append(key, item));
      }
    });

    const base = Linking.createURL('solflare-connect', { scheme: 'blockdeliveryapp' });
    const url = query.toString() ? `${base}?${query.toString()}` : base;
    handleSolflareCallbackUrl(url);
  }, [params]);

  return <Redirect href="/(tabs)/wallet" />;
}
