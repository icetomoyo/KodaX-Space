import { projectStore } from '../projects/store.js';
import { partnerKbStore } from '../kodax/partner-kb-store.js';
import { registerChannel } from './register.js';

async function assertProject(projectRoot: string): Promise<string> {
  return projectStore.assertAllowed(projectRoot);
}

export function registerPartnerKbChannels(): void {
  registerChannel('partner.kb.summary', async (input) => {
    const projectRoot = await assertProject(input.projectRoot);
    return partnerKbStore.summary(projectRoot);
  });

  registerChannel('partner.kb.pages', async (input) => {
    const projectRoot = await assertProject(input.projectRoot);
    return { pages: await partnerKbStore.list(projectRoot, input.query) };
  });

  registerChannel('partner.kb.readPage', async (input) => {
    const projectRoot = await assertProject(input.projectRoot);
    const page = await partnerKbStore.get(projectRoot, {
      ...(input.pageId ? { id: input.pageId } : {}),
      ...(input.slug ? { slug: input.slug } : {}),
    });
    return { page };
  });

  registerChannel('partner.kb.writePage', async (input) => {
    const projectRoot = await assertProject(input.projectRoot);
    const result = await partnerKbStore.upsert({
      projectRoot,
      title: input.title,
      content: input.content,
      ...(input.slug ? { slug: input.slug } : {}),
      ...(input.pageType ? { pageType: input.pageType } : {}),
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.sources ? { sources: input.sources } : {}),
      ...(input.tags ? { tags: input.tags } : {}),
      ...(input.confidence ? { confidence: input.confidence } : {}),
      ...(input.status ? { status: input.status } : {}),
    });
    const summary = await partnerKbStore.summary(projectRoot);
    return { ...result, indexMarkdown: summary.indexMarkdown };
  });

  registerChannel('partner.kb.search', async (input) => {
    const projectRoot = await assertProject(input.projectRoot);
    return { matches: await partnerKbStore.search(projectRoot, input.query, input.limit) };
  });

  registerChannel('partner.kb.rebuildIndex', async (input) => {
    const projectRoot = await assertProject(input.projectRoot);
    return partnerKbStore.rebuildIndex(projectRoot);
  });

  registerChannel('partner.kb.lint', async (input) => {
    const projectRoot = await assertProject(input.projectRoot);
    return { issues: await partnerKbStore.lint(projectRoot) };
  });

  registerChannel('partner.kb.config.get', async (input) => {
    const projectRoot = await assertProject(input.projectRoot);
    return partnerKbStore.config(projectRoot);
  });

  registerChannel('partner.kb.config.set', async (input) => {
    const projectRoot = await assertProject(input.projectRoot);
    return partnerKbStore.setConfig({
      projectRoot,
      ...(input.pageGroups ? { pageGroups: input.pageGroups } : {}),
      ...(input.pinnedSources ? { pinnedSources: input.pinnedSources } : {}),
      ...(input.preferredSynthesisPages
        ? { preferredSynthesisPages: input.preferredSynthesisPages }
        : {}),
      ...(input.ignoredPaths ? { ignoredPaths: input.ignoredPaths } : {}),
      ...(input.claimPolicy ? { claimPolicy: input.claimPolicy } : {}),
      ...(input.freshnessWindowDays ? { freshnessWindowDays: input.freshnessWindowDays } : {}),
    });
  });

  registerChannel('partner.kb.maintenance.run', async (input) => {
    const projectRoot = await assertProject(input.projectRoot);
    return { report: await partnerKbStore.runMaintenance(projectRoot) };
  });

  registerChannel('partner.kb.maintenance.last', async (input) => {
    const projectRoot = await assertProject(input.projectRoot);
    return { report: await partnerKbStore.lastMaintenance(projectRoot) };
  });
}
