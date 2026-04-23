import { useCallback, useState } from 'react';
import { createProfile, ProfileMeta } from '../../../shared/lib/tauri';

export const useProfileCreate = (onCreated: (profile: ProfileMeta) => void) => {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!name.trim()) {
      setError('validationName');
      return;
    }
    if (password !== confirmPassword) {
      setError('validationMatch');
      return;
    }
    setError(null);
    const profile = await createProfile(name.trim(), password || undefined);
    onCreated(profile);
  }, [confirmPassword, name, onCreated, password]);

  return { name, password, confirmPassword, setName, setPassword, setConfirmPassword, submit, error };
};
