import React, { useEffect, useState } from 'react';
import { Users } from 'lucide-react';

interface UserSummary {
  userKey: string;
  lastActive: string | null;
  totalMessages: number;
}

interface Props {
  selected: string | null;
  onSelect: (userKey: string) => void;
}

export default function ThreadSelector({ selected, onSelect }: Props) {
  const [users, setUsers] = useState<UserSummary[]>([]);

  useEffect(() => {
    fetch('/api/kakao/users')
      .then(r => r.ok ? r.json() : [])
      .then(setUsers)
      .catch(() => {});
  }, []);

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-violet-900/20 border border-violet-500/20">
      <Users className="w-4 h-4 text-violet-400 flex-shrink-0" />
      <select
        value={selected ?? ''}
        onChange={e => { if (e.target.value) onSelect(e.target.value); }}
        className="flex-1 bg-transparent text-sm text-white focus:outline-none cursor-pointer"
      >
        <option value="">— select a user to coach on —</option>
        {users.map(u => (
          <option key={u.userKey} value={u.userKey}>
            {u.userKey} · {u.totalMessages} msgs
            {u.lastActive ? ` · ${new Date(u.lastActive).toLocaleDateString('ko-KR')}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
