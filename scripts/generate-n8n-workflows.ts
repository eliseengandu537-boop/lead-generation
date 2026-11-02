import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { jobKinds } from "../src/platform/jobs";

// Credentials are references only. Configure the actual header secret in n8n.
async function main() {
  await mkdir("n8n/workflows", { recursive: true });
  for (const kind of jobKinds) {
    const slug = kind.toLowerCase().replaceAll("_", "-");
    const source = "$('Receive job').first().json.body";
    const headers = {
      parameters: [
        { name: "Authorization", value: `={{ 'Bearer ' + ${source}.token }}` },
      ],
    };
    const nodes = [
      {
        id: "webhook",
        name: "Receive job",
        type: "n8n-nodes-base.webhook",
        typeVersion: 2,
        position: [0, 0],
        webhookId: `orbit-${slug}`,
        parameters: {
          httpMethod: "POST",
          path: `orbit-${slug}`,
          authentication: "headerAuth",
          responseMode: "onReceived",
          options: {},
        },
        credentials: {
          httpHeaderAuth: {
            id: "CONFIGURE_ORBIT_HEADER_AUTH",
            name: "Orbit webhook authentication",
          },
        },
      },
      {
        id: "admit",
        name: "Admit durable job",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [260, 0],
        parameters: {
          method: "POST",
          url: `={{ ${source}.runUrl }}`,
          sendHeaders: true,
          headerParameters: headers,
          sendBody: true,
          specifyBody: "json",
          jsonBody: `={{ JSON.stringify({ jobId: ${source}.jobId, workspaceId: ${source}.workspaceId }) }}`,
          options: {
            timeout: 10000,
            redirect: { redirect: { followRedirects: false } },
          },
        },
      },
      {
        id: "wait",
        name: "Wait for worker",
        type: "n8n-nodes-base.wait",
        typeVersion: 1.1,
        position: [520, 0],
        parameters: { amount: 10, unit: "seconds" },
      },
      {
        id: "status",
        name: "Read actual job result",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [780, 0],
        parameters: {
          url: `={{ ${source}.statusUrl }}`,
          sendHeaders: true,
          headerParameters: headers,
          options: {
            timeout: 10000,
            redirect: { redirect: { followRedirects: false } },
          },
        },
      },
      {
        id: "terminal",
        name: "Job finished",
        type: "n8n-nodes-base.if",
        typeVersion: 2.2,
        position: [1040, 0],
        parameters: {
          conditions: {
            options: {
              caseSensitive: true,
              leftValue: "",
              typeValidation: "strict",
              version: 2,
            },
            conditions: [
              {
                id: "is-terminal",
                leftValue: "={{ $json.terminal }}",
                rightValue: true,
                operator: {
                  type: "boolean",
                  operation: "true",
                  singleValue: true,
                },
              },
            ],
            combinator: "and",
          },
          options: {},
        },
      },
    ];
    const link = (node: string) => ({ node, type: "main", index: 0 });
    const workflow = {
      name: `Orbit · ${kind}`,
      active: false,
      nodes,
      connections: {
        "Receive job": { main: [[link("Admit durable job")]] },
        "Admit durable job": { main: [[link("Wait for worker")]] },
        "Wait for worker": { main: [[link("Read actual job result")]] },
        "Read actual job result": { main: [[link("Job finished")]] },
        "Job finished": { main: [[], [link("Wait for worker")]] },
      },
      settings: {
        executionOrder: "v1",
        executionTimeout: 1800,
        saveDataSuccessExecution: "none",
        saveDataErrorExecution: "none",
        saveManualExecutions: false,
      },
      tags: [],
    };
    await writeFile(
      path.join("n8n/workflows", `${slug}.json`),
      JSON.stringify(workflow, null, 2) + "\n",
    );
  }
  console.log(
    `Generated ${jobKinds.length} inactive workflows. Configure credentials and validate in your n8n instance before activation.`,
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
