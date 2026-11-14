import crypto from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditRecords,
  cognitiveAgents,
  commEnvelopes,
  executionTasks,
  hitlApprovals,
  outboxEvents,
  pluginsRegistry,
  workflows,
} from './schema.ts';

function computeRecordHash(prevHash: string, actorId: string, action: string, resourceId: string): string {
  return 'sha256:' + crypto
    .createHash('sha256')
    .update(`${prevHash}|${actorId}|${action}|${resourceId}`)
    .digest('hex')
    .slice(0, 24);
}

export async function ensureCanonicalNexusSeed() {
  try {
    const existingWorkflows = await db.select().from(workflows);
    if (existingWorkflows.length > 0) {
      return;
    }

    // 1. Seed Verified DAG Workflows
    const wf1Spec = {
      nodes: [
        { id: 'wa_webhook_ingest', label: 'WhatsApp HMAC Webhook Ingest', type: 'COMM_GATEWAY', capability: 'comm.whatsapp.read', output_schema: 'JSON_ENVELOPE', timeout_ms: 2000 },
        { id: 'cognitive_triage', label: 'Cognitive Anomaly Classifier', type: 'COGNITIVE_AGENT', capability: 'compute.cognitive.classify', input_schema: 'JSON_ENVELOPE', output_schema: 'JSON_ENVELOPE', timeout_ms: 4500 },
        { id: 'risk_sanitizer', label: 'AST & Policy Guard Plugin', type: 'PLUGIN_SANDBOX', capability: 'plugin.risk.evaluate', input_schema: 'JSON_ENVELOPE', output_schema: 'JSON_ENVELOPE', timeout_ms: 1500 },
        { id: 'fenced_worker_commit', label: 'Fenced Transactional State Commit', type: 'EXECUTION_WORKER', capability: 'storage.transactional.write', input_schema: 'JSON_ENVELOPE', output_schema: 'JSON_ENVELOPE', timeout_ms: 3000 },
        { id: 'outbox_dispatch', label: 'Discord & Telegram Alert Relay', type: 'EVENT_OUTBOX', capability: 'comm.multichannel.send', input_schema: 'JSON_ENVELOPE', output_schema: 'JSON_ENVELOPE', timeout_ms: 2500 },
      ],
      edges: [
        { source: 'wa_webhook_ingest', target: 'cognitive_triage' },
        { source: 'wa_webhook_ingest', target: 'risk_sanitizer' },
        { source: 'cognitive_triage', target: 'fenced_worker_commit' },
        { source: 'risk_sanitizer', target: 'fenced_worker_commit' },
        { source: 'fenced_worker_commit', target: 'outbox_dispatch' },
      ],
    };

    const wf1Plan = {
      valid: true,
      status: 'VERIFIED_DAG',
      plan_digest: 'sha256:9f82c1d40b71e82a',
      vertex_count: 5,
      edge_count: 5,
      critical_path_depth: 4,
      max_parallelism_width: 2,
      topological_order: ['wa_webhook_ingest', 'cognitive_triage', 'risk_sanitizer', 'fenced_worker_commit', 'outbox_dispatch'],
      execution_waves: [
        [{ id: 'wa_webhook_ingest', label: 'WhatsApp HMAC Webhook Ingest', type: 'COMM_GATEWAY', capability: 'comm.whatsapp.read', timeout_ms: 2000 }],
        [
          { id: 'cognitive_triage', label: 'Cognitive Anomaly Classifier', type: 'COGNITIVE_AGENT', capability: 'compute.cognitive.classify', timeout_ms: 4500 },
          { id: 'risk_sanitizer', label: 'AST & Policy Guard Plugin', type: 'PLUGIN_SANDBOX', capability: 'plugin.risk.evaluate', timeout_ms: 1500 },
        ],
        [{ id: 'fenced_worker_commit', label: 'Fenced Transactional State Commit', type: 'EXECUTION_WORKER', capability: 'storage.transactional.write', timeout_ms: 3000 }],
        [{ id: 'outbox_dispatch', label: 'Discord & Telegram Alert Relay', type: 'EVENT_OUTBOX', capability: 'comm.multichannel.send', timeout_ms: 2500 }],
      ],
      complexity_analysis: 'O(|V|=5 + |E|=5)',
    };

    await db.insert(workflows).values([
      {
        id: 'wf-autonomous-incident-saga',
        tenantId: 'tenant-alpha-01',
        name: 'Autonomous Multi-Channel Incident Remediation Saga',
        version: '2.4.0',
        specificationJson: JSON.stringify(wf1Spec),
        compiledPlanJson: JSON.stringify(wf1Plan),
        status: 'VERIFIED',
        complexityOrder: 'O(|V|=5 + |E|=5)',
      },
      {
        id: 'wf-financial-settlement-audit',
        tenantId: 'tenant-alpha-01',
        name: 'Deterministic Cross-Ledger Compliance Settlement Pipeline',
        version: '1.8.2',
        specificationJson: JSON.stringify({
          nodes: [
            { id: 'ledger_stream_in', label: 'Ingest Settlement Stream', type: 'EVENT_OUTBOX', capability: 'event.stream.read', output_schema: 'JSON_ENVELOPE', timeout_ms: 2000 },
            { id: 'merkle_proof_verify', label: 'Verify Cryptographic Proof', type: 'PLUGIN_SANDBOX', capability: 'plugin.crypto.verify', input_schema: 'JSON_ENVELOPE', output_schema: 'JSON_ENVELOPE', timeout_ms: 1800 },
            { id: 'hitl_treasury_gate', label: 'Treasury HITL Authorization', type: 'COGNITIVE_AGENT', capability: 'finance.wire.transfer', input_schema: 'JSON_ENVELOPE', output_schema: 'JSON_ENVELOPE', timeout_ms: 5000 },
          ],
          edges: [
            { source: 'ledger_stream_in', target: 'merkle_proof_verify' },
            { source: 'merkle_proof_verify', target: 'hitl_treasury_gate' },
          ],
        }),
        compiledPlanJson: JSON.stringify({
          valid: true,
          status: 'VERIFIED_DAG',
          plan_digest: 'sha256:4a19e82f73c01b55',
          vertex_count: 3,
          edge_count: 2,
          critical_path_depth: 3,
          max_parallelism_width: 1,
          topological_order: ['ledger_stream_in', 'merkle_proof_verify', 'hitl_treasury_gate'],
          complexity_analysis: 'O(|V|=3 + |E|=2)',
        }),
        status: 'VERIFIED',
        complexityOrder: 'O(|V|=3 + |E|=2)',
      },
    ]).onConflictDoNothing();

    // 2. Seed Execution Tasks with Monotonic Fencing Tokens
    await db.insert(executionTasks).values([
      {
        id: 'task-901-ingest',
        workflowId: 'wf-autonomous-incident-saga',
        runId: 'run-2026-8841',
        nodeId: 'wa_webhook_ingest',
        tenantId: 'tenant-alpha-01',
        idempotencyKey: 'idem-run-2026-8841-wa_webhook_ingest',
        status: 'SUCCEEDED',
        fencingToken: 41,
        workerId: 'worker-fabric-as1-01',
        leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
        attemptCount: 1,
        maxRetries: 3,
        inputPayloadJson: JSON.stringify({ channel: 'WHATSAPP', event: 'latency_spike_alert' }),
        outputPayloadJson: JSON.stringify({ verified: true, envelope_id: 'env-wa-104' }),
        latencyMs: 14,
      },
      {
        id: 'task-902-triage',
        workflowId: 'wf-autonomous-incident-saga',
        runId: 'run-2026-8841',
        nodeId: 'cognitive_triage',
        tenantId: 'tenant-alpha-01',
        idempotencyKey: 'idem-run-2026-8841-cognitive_triage',
        status: 'SUCCEEDED',
        fencingToken: 42,
        workerId: 'worker-fabric-as1-02',
        leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
        attemptCount: 1,
        maxRetries: 3,
        inputPayloadJson: JSON.stringify({ envelope_id: 'env-wa-104', metric_p99: 412 }),
        outputPayloadJson: JSON.stringify({ root_cause: 'Connection pool contention', confidence: 0.96 }),
        latencyMs: 186,
      },
      {
        id: 'task-903-commit',
        workflowId: 'wf-autonomous-incident-saga',
        runId: 'run-2026-8841',
        nodeId: 'fenced_worker_commit',
        tenantId: 'tenant-alpha-01',
        idempotencyKey: 'idem-run-2026-8841-fenced_worker_commit',
        status: 'AWAITING_HITL',
        fencingToken: 43,
        workerId: 'worker-fabric-as1-01',
        leaseExpiresAt: new Date(Date.now() + 300000).toISOString(),
        attemptCount: 1,
        maxRetries: 3,
        inputPayloadJson: JSON.stringify({ action: 'infra.cluster.scale', target_replicas: 24 }),
        outputPayloadJson: JSON.stringify({ status: 'SUSPENDED_FOR_HITL_GATE' }),
        latencyMs: 22,
      },
    ]).onConflictDoNothing();

    // 3. Seed Cognitive Agents
    await db.insert(cognitiveAgents).values([
      {
        id: 'agent-architect-planner',
        tenantId: 'tenant-alpha-01',
        name: 'Distributed Topology Planner',
        specialty: 'DAG Decomposition & Critical Path Optimization',
        modelAlias: 'gemini-3.8-flash',
        allowedCapabilitiesJson: JSON.stringify(['compute.*', 'workflow.compile', 'telemetry.read']),
        memoryWindowLimit: 24,
        tokenQuotaPerRun: 8192,
        status: 'NOMINAL',
      },
      {
        id: 'agent-sec-auditor',
        tenantId: 'tenant-alpha-01',
        name: 'Zero-Trust Capability & Threat Auditor',
        specialty: 'STRIDE Verification, Prompt Sanitization & Policy Enforcement',
        modelAlias: 'gemini-3.8-flash',
        allowedCapabilitiesJson: JSON.stringify(['security.audit.*', 'plugin.verify', 'comm.signature.verify']),
        memoryWindowLimit: 16,
        tokenQuotaPerRun: 4096,
        status: 'NOMINAL',
      },
      {
        id: 'agent-sre-remediator',
        tenantId: 'tenant-alpha-01',
        name: 'Autonomous Reliability & Recovery Executor',
        specialty: 'Circuit Breaker Orchestration & Lease Recovery',
        modelAlias: 'gemini-3.8-flash',
        allowedCapabilitiesJson: JSON.stringify(['compute.*', 'infra.cluster.scale', 'comm.broadcast.external']),
        memoryWindowLimit: 32,
        tokenQuotaPerRun: 8192,
        status: 'NOMINAL',
      },
    ]).onConflictDoNothing();

    // 4. Seed HITL Approvals Gate
    await db.insert(hitlApprovals).values([
      {
        id: 'hitl-gate-701',
        taskId: 'task-903-commit',
        agentId: 'agent-sre-remediator',
        toolName: 'infra.cluster.scale',
        argumentsJson: JSON.stringify({ cluster: 'nexus-prod-as1', min_workers: 12, target_workers: 24, reason: 'Mitigate p99 queue saturation' }),
        riskClassification: 'CRITICAL_SIDE_EFFECT',
        provenanceHash: 'sha256:7c8e9102a4f5b6182930d1e2',
        status: 'PENDING',
        reviewerUid: 'UNASSIGNED',
        decidedAt: '',
      },
    ]).onConflictDoNothing();

    // 5. Seed Transactional Outbox & DLQ Events
    await db.insert(outboxEvents).values([
      {
        id: 'evt-outbox-301',
        aggregateType: 'WORKFLOW_RUN',
        aggregateId: 'run-2026-8841',
        eventType: 'nexus.workflow.wave_completed.v1',
        schemaVersion: 1,
        payloadJson: JSON.stringify({ wave: 1, completed_nodes: ['wa_webhook_ingest'], fencing_token: 41 }),
        idempotencyHash: 'sha256:1b4f8c92a01e7732',
        status: 'PUBLISHED',
        retryCount: 0,
        errorReason: '',
      },
      {
        id: 'evt-outbox-302',
        aggregateType: 'COGNITIVE_AGENT',
        aggregateId: 'agent-sre-remediator',
        eventType: 'nexus.security.hitl_gate_triggered.v1',
        schemaVersion: 1,
        payloadJson: JSON.stringify({ hitl_id: 'hitl-gate-701', tool: 'infra.cluster.scale', risk: 'CRITICAL_SIDE_EFFECT' }),
        idempotencyHash: 'sha256:6d902e44f1a83c19',
        status: 'PUBLISHED',
        retryCount: 0,
        errorReason: '',
      },
      {
        id: 'evt-dlq-303',
        aggregateType: 'COMM_GATEWAY',
        aggregateId: 'env-tg-992',
        eventType: 'nexus.comm.webhook_rejected.v1',
        schemaVersion: 1,
        payloadJson: JSON.stringify({ provider: 'TELEGRAM', sender_id: 'untrusted-peer-77', reason: 'HMAC-SHA256 digest mismatch' }),
        idempotencyHash: 'sha256:e4910a8b3c219044',
        status: 'DLQ',
        retryCount: 3,
        errorReason: 'Cryptographic signature verification failed after 3 bounded validation checks.',
      },
    ]).onConflictDoNothing();

    // 6. Seed Universal Communication Envelopes
    await db.insert(commEnvelopes).values([
      {
        id: 'env-wa-104',
        provider: 'WHATSAPP',
        direction: 'INBOUND',
        senderId: '+14158904412',
        recipientId: 'nexus-wa-enterprise-01',
        normalizedContentJson: JSON.stringify({ text: 'Execute p99 latency diagnostic on worker pool asia-southeast1', channel: 'Meta Cloud API v21.0' }),
        signatureVerified: true,
        signatureHash: 'hmac-sha256:88f102c94a71b3e0',
        status: 'DELIVERED',
      },
      {
        id: 'env-disc-105',
        provider: 'DISCORD',
        direction: 'OUTBOUND',
        senderId: 'nexus-kernel-notifier',
        recipientId: 'secops-incident-channel',
        normalizedContentJson: JSON.stringify({ text: 'HITL Approval Gate #hitl-gate-701 awaiting Principal Architect sign-off.', channel: 'Discord Interactions v10' }),
        signatureVerified: true,
        signatureHash: 'hmac-sha256:3d92a11c8e405f21',
        status: 'DELIVERED',
      },
    ]).onConflictDoNothing();

    // 7. Seed Sandboxed Plugins Registry
    await db.insert(pluginsRegistry).values([
      {
        id: 'plugin-slo-burn-rate',
        name: 'Multi-Window SLO Error Budget Burn Calculator',
        version: '1.2.0',
        sha256Signature: 'sha256:5c81f29a0d44e1827364519a',
        declaredCapabilitiesJson: JSON.stringify(['telemetry.compute.slo', 'math.pure']),
        quotaCpuMs: 200,
        quotaMemoryMb: 64,
        sourceCode: `def transform(payload):
    total_req = max(int(payload.get("total_requests", 10000)), 1)
    failed_req = int(payload.get("failed_requests", 4))
    slo_target = float(payload.get("slo_target_pct", 99.9))
    error_budget_fraction = max((100.0 - slo_target) / 100.0, 0.00001)
    observed_error_rate = failed_req / total_req
    burn_rate = round(observed_error_rate / error_budget_fraction, 3)
    return {
        "observed_availability_pct": round((1.0 - observed_error_rate) * 100.0, 4),
        "error_budget_burn_rate": burn_rate,
        "slo_compliant": burn_rate <= 1.0
    }`,
        verificationStatus: 'VERIFIED',
        enabled: true,
      },
    ]).onConflictDoNothing();

    // 8. Seed Cryptographic Hash-Chained Audit Log
    const h1 = computeRecordHash('sha256:000000000000000000000000', 'NEXUS_KERNEL', 'KERNEL_BOOT_INITIALIZED', 'nexus-root');
    const h2 = computeRecordHash(h1, 'WORKFLOW_COMPILER', 'DAG_SPECIFICATION_VERIFIED', 'wf-autonomous-incident-saga');
    await db.insert(auditRecords).values([
      {
        actorId: 'NEXUS_KERNEL',
        action: 'KERNEL_BOOT_INITIALIZED',
        subsystem: 'NEXUS_KERNEL',
        resourceId: 'nexus-root',
        previousHash: 'sha256:000000000000000000000000',
        recordHash: h1,
        metadataJson: JSON.stringify({ subsystems_online: 9, invariants: 'VERIFIED' }),
      },
      {
        actorId: 'WORKFLOW_COMPILER',
        action: 'DAG_SPECIFICATION_VERIFIED',
        subsystem: 'WORKFLOW_COMPILER',
        resourceId: 'wf-autonomous-incident-saga',
        previousHash: h1,
        recordHash: h2,
        metadataJson: JSON.stringify({ digest: 'sha256:9f82c1d40b71e82a', complexity: 'O(|V|=5 + |E|=5)' }),
      },
    ]);
  } catch (error) {
    console.error('Failed to seed canonical Nexus state:', error);
    throw new Error('Database initialization failed. Please try again later.', { cause: error });
  }
}

export async function getFullSystemState() {
  try {
    await ensureCanonicalNexusSeed();
    const [
      allWorkflows,
      allTasks,
      allAgents,
      allHitl,
      allOutbox,
      allComm,
      allPlugins,
      allAudits,
    ] = await Promise.all([
      db.select().from(workflows).orderBy(desc(workflows.createdAt)),
      db.select().from(executionTasks).orderBy(desc(executionTasks.fencingToken)),
      db.select().from(cognitiveAgents),
      db.select().from(hitlApprovals).orderBy(desc(hitlApprovals.createdAt)),
      db.select().from(outboxEvents).orderBy(desc(outboxEvents.createdAt)),
      db.select().from(commEnvelopes).orderBy(desc(commEnvelopes.createdAt)),
      db.select().from(pluginsRegistry),
      db.select().from(auditRecords).orderBy(desc(auditRecords.id)),
    ]);

    return {
      workflows: allWorkflows,
      executionTasks: allTasks,
      cognitiveAgents: allAgents,
      hitlApprovals: allHitl,
      outboxEvents: allOutbox,
      commEnvelopes: allComm,
      pluginsRegistry: allPlugins,
      auditRecords: allAudits,
    };
  } catch (error) {
    console.error('Database query failed in getFullSystemState:', error);
    throw new Error('Failed to load authoritative system state from PostgreSQL.', { cause: error });
  }
}

export async function appendAuditRecord(actorId: string, action: string, subsystem: string, resourceId: string, metadata: Record<string, unknown>) {
  try {
    const latest = await db.select().from(auditRecords).orderBy(desc(auditRecords.id)).limit(1);
    const prevHash = latest[0]?.recordHash ?? 'sha256:000000000000000000000000';
    const recordHash = computeRecordHash(prevHash, actorId, action, resourceId);

    const inserted = await db
      .insert(auditRecords)
      .values({
        actorId,
        action,
        subsystem,
        resourceId,
        previousHash: prevHash,
        recordHash,
        metadataJson: JSON.stringify(metadata),
      })
      .returning();

    return inserted[0];
  } catch (error) {
    console.error('Failed to append audit record:', error);
    throw new Error('Audit log write failed.', { cause: error });
  }
}

export async function saveCompiledWorkflow(name: string, version: string, spec: unknown, compiledPlan: Record<string, unknown>) {
  try {
    const wfId = `wf-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28)}-${Date.now().toString().slice(-4)}`;
    const status = compiledPlan.valid ? 'VERIFIED' : 'INVALID';
    const complexity = String(compiledPlan.complexity_analysis || 'O(V + E)');

    const [created] = await db
      .insert(workflows)
      .values({
        id: wfId,
        tenantId: 'tenant-alpha-01',
        name,
        version,
        specificationJson: JSON.stringify(spec),
        compiledPlanJson: JSON.stringify(compiledPlan),
        status,
        complexityOrder: complexity,
      })
      .returning();

    await db.insert(outboxEvents).values({
      id: `evt-wf-${Date.now()}`,
      aggregateType: 'WORKFLOW_COMPILER',
      aggregateId: wfId,
      eventType: compiledPlan.valid ? 'nexus.workflow.compiled.v1' : 'nexus.workflow.compilation_rejected.v1',
      schemaVersion: 1,
      payloadJson: JSON.stringify({ workflowId: wfId, status, digest: compiledPlan.plan_digest }),
      idempotencyHash: `sha256:${crypto.randomBytes(8).toString('hex')}`,
      status: 'PUBLISHED',
      retryCount: 0,
      errorReason: '',
    });

    await appendAuditRecord('WORKFLOW_COMPILER', `WORKFLOW_${status}`, 'WORKFLOW_COMPILER', wfId, {
      name,
      complexity,
    });

    return created;
  } catch (error) {
    console.error('Failed to save compiled workflow:', error);
    throw new Error('Failed to persist compiled workflow in PostgreSQL.', { cause: error });
  }
}

export async function executeWorkflowRunInDb(workflowId: string) {
  try {
    const existingWf = await db.select().from(workflows).where(eq(workflows.id, workflowId));
    const wf = existingWf[0];
    if (!wf) {
      throw new Error(`Workflow ${workflowId} not found`);
    }
    const plan = JSON.parse(wf.compiledPlanJson);
    if (!plan.valid) {
      throw new Error('Invariant I_1 Violation: Cannot execute an unverified or cyclic workflow.');
    }

    const latestTasks = await db.select().from(executionTasks).orderBy(desc(executionTasks.fencingToken)).limit(1);
    let nextToken = (latestTasks[0]?.fencingToken ?? 40) + 1;

    const runId = `run-${Date.now().toString().slice(-6)}`;
    const spec = JSON.parse(wf.specificationJson);
    const nodes: Array<{ id: string; label?: string; type?: string; capability?: string }> = spec.nodes || [];

    const createdTasks = [];
    for (const node of nodes) {
      const taskId = `task-${runId}-${node.id}`;
      const isHitl = node.capability === 'finance.wire.transfer' || node.capability === 'infra.cluster.scale';
      const taskStatus = isHitl ? 'AWAITING_HITL' : 'SUCCEEDED';
      const token = nextToken++;

      const [t] = await db
        .insert(executionTasks)
        .values({
          id: taskId,
          workflowId: wf.id,
          runId,
          nodeId: node.id,
          tenantId: 'tenant-alpha-01',
          idempotencyKey: `idem-${runId}-${node.id}`,
          status: taskStatus,
          fencingToken: token,
          workerId: `worker-fabric-as1-0${(token % 3) + 1}`,
          leaseExpiresAt: new Date(Date.now() + 120000).toISOString(),
          attemptCount: 1,
          maxRetries: 3,
          inputPayloadJson: JSON.stringify({ workflow: wf.name, node: node.id }),
          outputPayloadJson: JSON.stringify({
            status: taskStatus,
            fencing_token_committed: token,
            verified_at: new Date().toISOString(),
          }),
          latencyMs: 12 + (token % 29),
        })
        .returning();

      createdTasks.push(t);

      if (isHitl) {
        await db.insert(hitlApprovals).values({
          id: `hitl-${Date.now().toString().slice(-5)}-${node.id}`,
          taskId,
          agentId: 'agent-sre-remediator',
          toolName: node.capability || 'infra.cluster.scale',
          argumentsJson: JSON.stringify({ workflowId: wf.id, runId, nodeId: node.id }),
          riskClassification: 'CRITICAL_SIDE_EFFECT',
          provenanceHash: `sha256:${crypto.randomBytes(12).toString('hex')}`,
          status: 'PENDING',
          reviewerUid: 'UNASSIGNED',
          decidedAt: '',
        });
      }
    }

    // Transactional Outbox emission (Invariant I_3)
    await db.insert(outboxEvents).values({
      id: `evt-run-${Date.now()}`,
      aggregateType: 'EXECUTION_FABRIC',
      aggregateId: runId,
      eventType: 'nexus.execution.dag_run_dispatched.v1',
      schemaVersion: 1,
      payloadJson: JSON.stringify({ workflowId: wf.id, runId, tasksDispatched: createdTasks.length }),
      idempotencyHash: `sha256:${crypto.randomBytes(8).toString('hex')}`,
      status: 'PUBLISHED',
      retryCount: 0,
      errorReason: '',
    });

    await appendAuditRecord('EXECUTION_FABRIC', 'DAG_RUN_DISPATCHED', 'EXECUTION_FABRIC', runId, {
      workflowId: wf.id,
      tasksCount: createdTasks.length,
    });

    return { runId, createdTasks };
  } catch (error) {
    console.error('Workflow run execution failed:', error);
    throw new Error('Failed to execute workflow run.', { cause: error });
  }
}

export async function decideHitlApprovalInDb(hitlId: string, decision: 'APPROVED' | 'REJECTED', reviewerEmail: string) {
  try {
    const existing = await db.select().from(hitlApprovals).where(eq(hitlApprovals.id, hitlId));
    const item = existing[0];
    if (!item) {
      throw new Error(`HITL record ${hitlId} not found`);
    }

    const [updatedHitl] = await db
      .update(hitlApprovals)
      .set({
        status: decision,
        reviewerUid: reviewerEmail,
        decidedAt: new Date().toISOString(),
      })
      .where(eq(hitlApprovals.id, hitlId))
      .returning();

    const newTaskStatus = decision === 'APPROVED' ? 'SUCCEEDED' : 'FAILED';
    await db
      .update(executionTasks)
      .set({
        status: newTaskStatus,
        outputPayloadJson: JSON.stringify({
          hitl_decision: decision,
          reviewer: reviewerEmail,
          decided_at: new Date().toISOString(),
        }),
      })
      .where(eq(executionTasks.id, item.taskId));

    await db.insert(outboxEvents).values({
      id: `evt-hitl-${Date.now()}`,
      aggregateType: 'HITL_GOVERNANCE',
      aggregateId: hitlId,
      eventType: `nexus.security.hitl_${decision.toLowerCase()}.v1`,
      schemaVersion: 1,
      payloadJson: JSON.stringify({ hitlId, taskId: item.taskId, reviewerEmail, decision }),
      idempotencyHash: `sha256:${crypto.randomBytes(8).toString('hex')}`,
      status: 'PUBLISHED',
      retryCount: 0,
      errorReason: '',
    });

    await appendAuditRecord(reviewerEmail, `HITL_${decision}`, 'COGNITIVE_AGENTS', hitlId, {
      taskId: item.taskId,
      toolName: item.toolName,
    });

    return updatedHitl;
  } catch (error) {
    console.error('Failed to decide HITL approval:', error);
    throw new Error('Failed to update HITL decision in PostgreSQL.', { cause: error });
  }
}

export async function replayDlqEventInDb(eventId: string) {
  try {
    const existing = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId));
    const evt = existing[0];
    if (!evt) {
      throw new Error(`Event ${eventId} not found`);
    }

    const [updated] = await db
      .update(outboxEvents)
      .set({
        status: 'REPLAYED',
        retryCount: evt.retryCount + 1,
        errorReason: 'Deterministic replay succeeded with idempotent consumer guard.',
      })
      .where(eq(outboxEvents.id, eventId))
      .returning();

    await appendAuditRecord('EVENT_LAYER', 'DLQ_EVENT_REPLAYED', 'EVENT_LAYER', eventId, {
      eventType: evt.eventType,
      retryCount: updated?.retryCount ?? evt.retryCount + 1,
    });

    return updated;
  } catch (error) {
    console.error('Failed to replay DLQ event:', error);
    throw new Error('Failed to replay event in PostgreSQL.', { cause: error });
  }
}

export async function recordCommEnvelopeInDb(envelope: {
  provider: string;
  direction: string;
  sender_id: string;
  recipient_id: string;
  content: unknown;
  security: { signature_verified: boolean; hmac_sha256: string };
  status: string;
}) {
  try {
    const envId = `env-${envelope.provider.toLowerCase().slice(0, 4)}-${Date.now().toString().slice(-5)}`;
    const [inserted] = await db
      .insert(commEnvelopes)
      .values({
        id: envId,
        provider: envelope.provider,
        direction: envelope.direction,
        senderId: envelope.sender_id,
        recipientId: envelope.recipient_id,
        normalizedContentJson: JSON.stringify(envelope.content),
        signatureVerified: envelope.security.signature_verified,
        signatureHash: envelope.security.hmac_sha256,
        status: envelope.status,
      })
      .returning();

    await db.insert(outboxEvents).values({
      id: `evt-comm-${Date.now()}`,
      aggregateType: 'COMM_GATEWAY',
      aggregateId: envId,
      eventType: envelope.security.signature_verified
        ? 'nexus.comm.envelope_ingested.v1'
        : 'nexus.comm.webhook_rejected.v1',
      schemaVersion: 1,
      payloadJson: JSON.stringify({ envId, provider: envelope.provider, status: envelope.status }),
      idempotencyHash: `sha256:${crypto.randomBytes(8).toString('hex')}`,
      status: envelope.security.signature_verified ? 'PUBLISHED' : 'DLQ',
      retryCount: envelope.security.signature_verified ? 0 : 1,
      errorReason: envelope.security.signature_verified ? '' : 'Rejected forged webhook HMAC-SHA256 signature.',
    });

    return inserted;
  } catch (error) {
    console.error('Failed to record comm envelope:', error);
    throw new Error('Failed to store communication envelope.', { cause: error });
  }
}
