import * as Linking from 'expo-linking';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { handlePhantomCallbackUrl } from '@/lib/phantom-callback';

export default function PhantomConnectScreen() {
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

    const base = Linking.createURL('phantom-connect', { scheme: 'blockdeliveryapp' });
    const url = query.toString() ? `${base}?${query.toString()}` : base;
    handlePhantomCallbackUrl(url);
  }, [params]);

  return <Redirect href="/(tabs)/wallet" />;
}
