import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

// Configuration injected by DevKiller runtime
const getRuntimeConfig = () => {
  if (typeof window !== 'undefined' && (window as any).__DK_SUPABASE__) {
    return (window as any).__DK_SUPABASE__;
  }
  return {
    url: typeof window !== 'undefined' ? window.location.origin + '/supabase' : 'http://127.0.0.1:3000/supabase',
    anonKey: 'placeholder-anon-key',
    schema: 'app',
  };
};

const config = getRuntimeConfig();
const supabase = createClient(config.url, config.anonKey, {
  db: { schema: 'app' },
  auth: { persistSession: false, autoRefreshToken: false },
});

interface Client {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  created_at: string;
}

export default function App() {
  const [tab, setTab] = useState<'dash' | 'clients'>('dash');
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  // Form states
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchClients = async () => {
    setLoading(true);
    try {
      const { data, error: fetchErr } = await supabase
        .schema('app')
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchErr) {
        setError('Erro ao carregar clientes do servidor: ' + fetchErr.message);
      } else if (data) {
        setClients(data as Client[]);
      }
    } catch (e: any) {
      setError('Falha de comunicação com o backend: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Client-side validation
    if (!name.trim()) {
      setError('O nome do cliente é obrigatório.');
      return;
    }
    if (!phone.trim()) {
      setError('O telefone do cliente é obrigatório.');
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('O formato do e-mail é inválido.');
      return;
    }

    setSaving(true);
    try {
      const { data, error: insertErr } = await supabase
        .schema('app')
        .from('clients')
        .insert([
          {
            name: name.trim(),
            phone: phone.trim(),
            email: email.trim() || null,
          },
        ])
        .select();

      if (insertErr) {
        setError('Erro ao salvar no banco: ' + insertErr.message);
      } else if (data && data.length > 0) {
        setSuccess('Cliente cadastrado com sucesso!');
        setName('');
        setPhone('');
        setEmail('');
        await fetchClients();
      } else {
        setError('Servidor não confirmou gravação.');
      }
    } catch (e: any) {
      setError('Falha na requisição ao servidor: ' + (e.message || 'Erro desconhecido'));
    } finally {
      setSaving(false);
    }
  };

  const filteredClients = clients.filter(c => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q);
  });

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="brand">
          <span className="brand-badge">PRO</span>
          <h1>PC Service</h1>
        </div>
        <nav className="app-nav">
          <button
            className={`nav-btn ${tab === 'dash' ? 'active' : ''}`}
            data-testid="nav-dashboard"
            onClick={() => { setTab('dash'); setError(null); setSuccess(null); }}
          >
            Dashboard
          </button>
          <button
            className={`nav-btn ${tab === 'clients' ? 'active' : ''}`}
            data-testid="nav-clients"
            onClick={() => { setTab('clients'); setError(null); setSuccess(null); fetchClients(); }}
          >
            Clientes ({clients.length})
          </button>
        </nav>
      </header>

      <main className="app-main">
        {tab === 'dash' && (
          <section className="dashboard-view">
            <h2>Visão Geral do Sistema</h2>
            <div className="kpi-grid">
              <div className="kpi-card">
                <span className="kpi-label">Clientes Ativos</span>
                <span className="kpi-value">{clients.length}</span>
                <span className="kpi-desc">Sincronizados com PostgreSQL</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Banco de Dados</span>
                <span className="kpi-value badge-online">Conectado</span>
                <span className="kpi-desc">PostgreSQL 17 + PostgREST</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Armazenamento</span>
                <span className="kpi-value">Dedicado</span>
                <span className="kpi-desc">Schema seguro e isolado</span>
              </div>
            </div>

            <div className="recent-card">
              <h3>Últimos Clientes Cadastrados</h3>
              {clients.length === 0 ? (
                <p className="empty-text">Nenhum cliente cadastrado no banco ainda.</p>
              ) : (
                <ul className="recent-list">
                  {clients.slice(0, 5).map(c => (
                    <li key={c.id} className="recent-item">
                      <strong>{c.name}</strong> — {c.phone} {c.email ? `(${c.email})` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {tab === 'clients' && (
          <section className="clients-view">
            <div className="split-layout">
              {/* Form Section */}
              <div className="form-card">
                <h2>Novo Cliente</h2>
                <form onSubmit={handleSave}>
                  <div className="form-group">
                    <label htmlFor="c-name">Nome Completo *</label>
                    <input
                      id="c-name"
                      type="text"
                      data-testid="client-name"
                      placeholder="Ex: João da Silva"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      disabled={saving}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="c-phone">Telefone / WhatsApp *</label>
                    <input
                      id="c-phone"
                      type="text"
                      data-testid="client-phone"
                      placeholder="Ex: (11) 98765-4321"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      disabled={saving}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="c-email">E-mail (Opcional)</label>
                    <input
                      id="c-email"
                      type="email"
                      data-testid="client-email"
                      placeholder="Ex: joao@email.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      disabled={saving}
                    />
                  </div>

                  {error && (
                    <div className="alert-error" data-testid="client-error">
                      {error}
                    </div>
                  )}

                  {success && (
                    <div className="alert-success" data-testid="client-success">
                      {success}
                    </div>
                  )}

                  <button
                    type="submit"
                    className="btn-primary"
                    data-testid="save-client"
                    disabled={saving}
                  >
                    {saving ? 'Gravando no Banco...' : 'Cadastrar Cliente'}
                  </button>
                </form>
              </div>

              {/* List Section */}
              <div className="list-card">
                <div className="list-header">
                  <h2>Clientes Cadastrados</h2>
                  <input
                    type="text"
                    className="search-input"
                    data-testid="client-search"
                    placeholder="Buscar por nome ou telefone..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>

                {loading ? (
                  <p className="loading-text">Carregando dados do servidor...</p>
                ) : filteredClients.length === 0 ? (
                  <p className="empty-text">Nenhum cliente encontrado.</p>
                ) : (
                  <div className="table-wrapper">
                    <table className="clients-table">
                      <thead>
                        <tr>
                          <th>Nome</th>
                          <th>Telefone</th>
                          <th>E-mail</th>
                          <th>Cadastrado em</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredClients.map(c => (
                          <tr key={c.id} data-testid="client-row">
                            <td className="font-semibold">{c.name}</td>
                            <td>{c.phone}</td>
                            <td>{c.email || '—'}</td>
                            <td className="text-muted">
                              {new Date(c.created_at).toLocaleDateString('pt-BR')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
