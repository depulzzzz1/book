import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api.ts';
import { useAuthStore } from '../../stores/useAuthStore.ts';
import {
  EditorialSkeleton,
  EmptyEditorialState,
  MetadataLine,
} from '../../components/ui/EditorialPrimitives.tsx';

interface AdminOverviewResponse {
  analytics: {
    totalUsers: number;
    activeUsers: number;
    totalNovels: number;
    publishedNovels: number;
    pendingReviewNovels: number;
    openReports: number;
    pendingAuthorVerifications: number;
    totalCatalogViews: number;
    totalPublishedWords: number;
  };
  pendingNovels: Array<{
    id: string;
    title: string;
    synopsis: string;
    authorName: string | null;
    createdAt: string;
  }>;
  pendingAuthors: Array<{
    userId: number;
    penName: string;
    biography: string;
    websiteUrl: string;
  }>;
  openReports: Array<{
    id: string;
    targetType: string;
    targetId: string;
    reason: string;
    details: string;
    createdAt: string;
  }>;
  recentAudits: Array<{
    id: number;
    actorEmail: string;
    action: string;
    resourceType: string;
    resourceId: string;
    recordHash: string;
    createdAt: string;
  }>;
  configs: Array<{
    key: string;
    valueJson: string;
    description: string;
  }>;
}

interface AdminUserRow {
  id: number;
  email: string;
  role: 'READER' | 'AUTHOR' | 'EDITOR' | 'ADMIN';
  authProvider: string;
  isActive: boolean;
  displayName: string | null;
}

interface AdminPermissionsResponse {
  roles: Array<{ id: string; name: string; description: string }>;
  permissions: Array<{ id: string; resource: string; action: string; description: string }>;
  rolePermissions: Array<{ roleId: string; permissionId: string }>;
}

export function AdminDashboardView() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'queues' | 'users' | 'audit'>('queues');
  const [rationale, setRationale] = useState('Approved per Litera editorial standards.');

  const overviewQuery = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => apiFetch<AdminOverviewResponse>('/api/admin/overview'),
    enabled: Boolean(user && ['EDITOR', 'ADMIN'].includes(user.role)),
  });

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => apiFetch<{ users: AdminUserRow[] }>('/api/admin/users'),
    enabled: Boolean(user && user.role === 'ADMIN' && tab === 'users'),
  });

  const permissionsQuery = useQuery({
    queryKey: ['admin-permissions'],
    queryFn: () => apiFetch<AdminPermissionsResponse>('/api/admin/permissions'),
    enabled: Boolean(user && user.role === 'ADMIN' && tab === 'users'),
  });

  const novelDecisionMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) =>
      apiFetch(`/api/admin/novels/${id}/decision`, {
        method: 'POST',
        json: { decision, rationale },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-overview'] }),
  });

  const verifyAuthorMutation = useMutation({
    mutationFn: ({ userId, status }: { userId: number; status: 'VERIFIED' | 'REJECTED' }) =>
      apiFetch(`/api/admin/authors/${userId}/verify`, {
        method: 'POST',
        json: { status, note: rationale },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-overview'] }),
  });

  const resolveReportMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'HIDE_CONTENT' | 'DISMISS' }) =>
      apiFetch(`/api/admin/reports/${id}/resolve`, {
        method: 'POST',
        json: { action, rationale },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-overview'] }),
  });

  const updateUserRoleMutation = useMutation({
    mutationFn: ({ id, role, isActive }: { id: number; role: string; isActive: boolean }) =>
      apiFetch(`/api/admin/users/${id}/role`, {
        method: 'PATCH',
        json: { role, isActive },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const updateConfigMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      apiFetch(`/api/admin/configs/${encodeURIComponent(key)}`, {
        method: 'PUT',
        json: { value },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-overview'] }),
  });

  if (!user || !['EDITOR', 'ADMIN'].includes(user.role)) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <EmptyEditorialState
          title="Editorial & Administrative Governance"
          description="This control center is restricted to Editorial Reviewers and Platform Administrators."
        />
      </div>
    );
  }

  const data = overviewQuery.data;

  return (
    <div className="mx-auto max-w-[1360px] px-6 py-10 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E6DFD1] pb-6">
        <div>
          <MetadataLine items={['Governance Control Center', `Role: ${user.role}`]} />
          <h1 className="font-display mt-2 text-3xl font-semibold text-[#1C1917]">
            Editorial Review & Platform Administration
          </h1>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab('queues')}
            className={`cursor-pointer border px-4 py-2 text-xs font-medium ${
              tab === 'queues'
                ? 'border-[#785032] bg-[#785032] text-white'
                : 'border-[#E6DFD1] bg-white text-[#57534E]'
            }`}
          >
            Moderation & Queues
          </button>
          {user.role === 'ADMIN' ? (
            <button
              type="button"
              onClick={() => setTab('users')}
              className={`cursor-pointer border px-4 py-2 text-xs font-medium ${
                tab === 'users'
                  ? 'border-[#785032] bg-[#785032] text-white'
                  : 'border-[#E6DFD1] bg-white text-[#57534E]'
              }`}
            >
              Users & Permissions
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setTab('audit')}
            className={`cursor-pointer border px-4 py-2 text-xs font-medium ${
              tab === 'audit'
                ? 'border-[#785032] bg-[#785032] text-white'
                : 'border-[#E6DFD1] bg-white text-[#57534E]'
            }`}
          >
            Audit Logs & Config
          </button>
        </div>
      </div>

      {overviewQuery.isLoading || !data ? (
        <EditorialSkeleton lines={8} />
      ) : (
        <>
          {/* Platform Analytics */}
          <div className="mt-6 grid grid-cols-2 gap-4 border-b border-[#E6DFD1] pb-6 sm:grid-cols-5">
            <div>
              <div className="text-xs text-[#57534E]">Registered Accounts</div>
              <div className="font-display mt-1 text-2xl font-semibold tabular-nums">
                {data.analytics.totalUsers}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#57534E]">Published Novels</div>
              <div className="font-display mt-1 text-2xl font-semibold tabular-nums">
                {data.analytics.publishedNovels}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#57534E]">Pending Novel Approvals</div>
              <div className="font-display mt-1 text-2xl font-semibold tabular-nums">
                {data.analytics.pendingReviewNovels}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#57534E]">Open Reports</div>
              <div className="font-display mt-1 text-2xl font-semibold tabular-nums">
                {data.analytics.openReports}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#57534E]">Catalog Reads</div>
              <div className="font-display mt-1 text-2xl font-semibold tabular-nums">
                {data.analytics.totalCatalogViews.toLocaleString()}
              </div>
            </div>
          </div>

          {tab === 'queues' ? (
            <div className="mt-8 space-y-10">
              <div className="border border-[#E6DFD1] bg-white p-5">
                <label className="block text-xs font-medium text-[#1C1917]">
                  Decision Rationale (recorded to moderation_actions & author notifications)
                </label>
                <input
                  type="text"
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  className="mt-1.5 w-full border border-[#D6CEBE] px-3 py-2 text-sm"
                />
              </div>

              {/* Novel Approval Queue */}
              <section>
                <h2 className="font-display text-2xl font-semibold text-[#1C1917]">
                  Novel Approval Queue ({data.pendingNovels.length})
                </h2>
                <div className="mt-4 space-y-4">
                  {data.pendingNovels.map((n) => (
                    <div key={n.id} className="border border-[#E6DFD1] bg-white p-6">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <h3 className="font-display text-xl font-semibold text-[#1C1917]">{n.title}</h3>
                          <MetadataLine items={[n.authorName || 'Author', new Date(n.createdAt).toLocaleDateString()]} />
                          <p className="mt-2 max-w-2xl text-sm text-[#57534E]">{n.synopsis}</p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => novelDecisionMutation.mutate({ id: n.id, decision: 'APPROVE' })}
                            className="cursor-pointer bg-[#166534] px-4 py-2 text-xs font-medium text-white"
                          >
                            Approve & Publish
                          </button>
                          <button
                            type="button"
                            onClick={() => novelDecisionMutation.mutate({ id: n.id, decision: 'REJECT' })}
                            className="cursor-pointer border border-[#991B1B] px-4 py-2 text-xs font-medium text-[#991B1B]"
                          >
                            Return to Author
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {data.pendingNovels.length === 0 ? (
                    <p className="text-sm text-[#57534E]">No manuscripts awaiting editorial review.</p>
                  ) : null}
                </div>
              </section>

              {/* Author Verification Queue */}
              <section>
                <h2 className="font-display text-2xl font-semibold text-[#1C1917]">
                  Author Verification Requests ({data.pendingAuthors.length})
                </h2>
                <div className="mt-4 space-y-4">
                  {data.pendingAuthors.map((a) => (
                    <div key={a.userId} className="flex flex-wrap items-center justify-between gap-4 border border-[#E6DFD1] bg-white p-5">
                      <div>
                        <div className="font-display text-lg font-semibold text-[#1C1917]">{a.penName}</div>
                        <p className="mt-1 text-xs text-[#57534E]">{a.biography || 'No bio submitted.'}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            verifyAuthorMutation.mutate({ userId: a.userId, status: 'VERIFIED' })
                          }
                          className="cursor-pointer bg-[#785032] px-4 py-2 text-xs font-medium text-white"
                        >
                          Verify Author
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            verifyAuthorMutation.mutate({ userId: a.userId, status: 'REJECTED' })
                          }
                          className="cursor-pointer border border-[#D6CEBE] px-4 py-2 text-xs font-medium"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                  {data.pendingAuthors.length === 0 ? (
                    <p className="text-sm text-[#57534E]">No pending author verification requests.</p>
                  ) : null}
                </div>
              </section>

              {/* Content Reports */}
              <section>
                <h2 className="font-display text-2xl font-semibold text-[#1C1917]">
                  Content Moderation Reports ({data.openReports.length})
                </h2>
                <div className="mt-4 space-y-4">
                  {data.openReports.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-4 border border-[#E6DFD1] bg-white p-5">
                      <div>
                        <MetadataLine items={[r.targetType, r.targetId, r.reason]} />
                        <p className="mt-1 text-sm text-[#1C1917]">{r.details || 'No additional notes.'}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => resolveReportMutation.mutate({ id: r.id, action: 'HIDE_CONTENT' })}
                          className="cursor-pointer bg-[#991B1B] px-4 py-2 text-xs font-medium text-white"
                        >
                          Hide Content
                        </button>
                        <button
                          type="button"
                          onClick={() => resolveReportMutation.mutate({ id: r.id, action: 'DISMISS' })}
                          className="cursor-pointer border border-[#D6CEBE] px-4 py-2 text-xs font-medium"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ))}
                  {data.openReports.length === 0 ? (
                    <p className="text-sm text-[#57534E]">No open moderation reports.</p>
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}

          {tab === 'users' && user.role === 'ADMIN' ? (
            <div className="mt-8 space-y-10">
              <section className="border border-[#E6DFD1] bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#E6DFD1] bg-[#FBF9F5] text-[#57534E]">
                      <tr>
                        <th className="px-4 py-3 font-medium">Name</th>
                        <th className="px-4 py-3 font-medium">Email</th>
                        <th className="px-4 py-3 font-medium">Role</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6DFD1]">
                      {(usersQuery.data?.users || []).map((u) => (
                        <tr key={u.id}>
                          <td className="px-4 py-3 font-medium text-[#1C1917]">
                            {u.displayName || 'Litera User'}
                          </td>
                          <td className="px-4 py-3 text-[#57534E]">{u.email}</td>
                          <td className="px-4 py-3">
                            <select
                              aria-label={`Role for ${u.email}`}
                              value={u.role}
                              onChange={(e) =>
                                updateUserRoleMutation.mutate({
                                  id: u.id,
                                  role: e.target.value,
                                  isActive: u.isActive,
                                })
                              }
                              className="border border-[#D6CEBE] bg-white px-2 py-1 text-xs"
                            >
                              <option value="READER">READER</option>
                              <option value="AUTHOR">AUTHOR</option>
                              <option value="EDITOR">EDITOR</option>
                              <option value="ADMIN">ADMIN</option>
                            </select>
                          </td>
                          <td className="px-4 py-3">{u.isActive ? 'Active' : 'Suspended'}</td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() =>
                                updateUserRoleMutation.mutate({
                                  id: u.id,
                                  role: u.role,
                                  isActive: !u.isActive,
                                })
                              }
                              className="cursor-pointer text-[#785032] hover:underline"
                            >
                              {u.isActive ? 'Suspend' : 'Reactivate'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {permissionsQuery.data ? (
                <section className="border border-[#E6DFD1] bg-white">
                  <div className="border-b border-[#E6DFD1] px-6 py-4">
                    <h2 className="font-display text-xl font-semibold text-[#1C1917]">
                      RBAC Role-Permission Matrix
                    </h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-[#E6DFD1] bg-[#FBF9F5] text-[#57534E]">
                        <tr>
                          <th className="px-4 py-3 font-medium">Permission</th>
                          {permissionsQuery.data.roles.map((r) => (
                            <th key={r.id} className="px-4 py-3 font-medium">
                              {r.id}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E6DFD1]">
                        {permissionsQuery.data.permissions.map((perm) => (
                          <tr key={perm.id}>
                            <td className="px-4 py-2.5">
                              <div className="font-mono text-[#1C1917]">{perm.id}</div>
                              <div className="text-[#57534E]">{perm.description}</div>
                            </td>
                            {permissionsQuery.data.roles.map((role) => {
                              const granted = permissionsQuery.data.rolePermissions.some(
                                (rp) => rp.roleId === role.id && rp.permissionId === perm.id
                              );
                              return (
                                <td key={role.id} className="px-4 py-2.5 font-mono text-[#57534E]">
                                  {granted ? 'Granted' : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}

          {tab === 'audit' ? (
            <div className="mt-8 space-y-10">
              {user.role === 'ADMIN' ? (
                <section className="border border-[#E6DFD1] bg-white p-6">
                  <h2 className="font-display text-xl font-semibold text-[#1C1917]">
                    System Configuration
                  </h2>
                  <div className="mt-4 divide-y divide-[#E6DFD1]">
                    {data.configs.map((cfg) => {
                      const val = JSON.parse(cfg.valueJson);
                      return (
                        <div key={cfg.key} className="flex flex-wrap items-center justify-between gap-4 py-3 text-xs">
                          <div>
                            <div className="font-mono font-medium text-[#1C1917]">{cfg.key}</div>
                            <div className="mt-0.5 text-[#57534E]">{cfg.description}</div>
                          </div>
                          {typeof val === 'boolean' ? (
                            <button
                              type="button"
                              onClick={() =>
                                updateConfigMutation.mutate({ key: cfg.key, value: !val })
                              }
                              className="cursor-pointer border border-[#D6CEBE] px-3 py-1.5 font-medium"
                            >
                              {val ? 'Enabled (Toggle)' : 'Disabled (Toggle)'}
                            </button>
                          ) : (
                            <span className="font-mono text-[#1C1917]">{String(val)}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              <section className="border border-[#E6DFD1] bg-white">
                <div className="border-b border-[#E6DFD1] px-6 py-4">
                  <h2 className="font-display text-xl font-semibold text-[#1C1917]">
                    Cryptographic Audit Ledger
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#E6DFD1] bg-[#FBF9F5] text-[#57534E]">
                      <tr>
                        <th className="px-4 py-3 font-medium">Timestamp</th>
                        <th className="px-4 py-3 font-medium">Actor</th>
                        <th className="px-4 py-3 font-medium">Action</th>
                        <th className="px-4 py-3 font-medium">Resource</th>
                        <th className="px-4 py-3 font-medium">Chain Digest</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6DFD1]">
                      {data.recentAudits.map((a) => (
                        <tr key={a.id}>
                          <td className="px-4 py-2.5 text-[#57534E] tabular-nums">
                            {new Date(a.createdAt).toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-[#1C1917]">{a.actorEmail}</td>
                          <td className="px-4 py-2.5 font-mono text-[#785032]">{a.action}</td>
                          <td className="px-4 py-2.5 text-[#57534E]">
                            {a.resourceType}:{a.resourceId}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[#57534E]">{a.recordHash}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
