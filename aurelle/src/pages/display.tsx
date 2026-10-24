import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Flower2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
export function DisplayPage() {
  const q = useQuery({
    queryKey: ['display'],
    queryFn: () => api('/display/snapshot'),
    refetchInterval: 5000,
  });
  return (
    <div className="public-display">
      <Flower2 size={45} strokeWidth={1} />
      <span className="eyebrow">AURELLE STUDIO</span>
      <h1>A little moment for you.</h1>
      <p>Please watch for your anonymous visit code.</p>
      <div className="display-grid">
        {q.data?.map((entry: any, i: number) => (
          <div key={i} className="card">
            <span>{entry.state === 'CALLED' ? 'You’re up next' : 'In good hands'}</span>
            <strong>{entry.token}</strong>
            <p>{entry.station}</p>
          </div>
        ))}
      </div>
      {!q.data?.length && <p>We’ll call your code when your station is ready.</p>}
      <Link className="btn" to="/queue">
        <ArrowLeft size={16} />
        Back to reception
      </Link>
    </div>
  );
}
