import { useCallback, useState } from 'react';
import { loginVault } from '../../../shared/lib/tauri';

export const useLogIn = (id: string, onSuccess: () => void) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const submit = useCallback(async () => {
    try {
      const ok = await loginVault(id, password);
      if (ok) {
        setError(false);
        onSuccess();
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    }
  }, [id, onSuccess, password]);

  return { password, setPassword, submit, error };
};
