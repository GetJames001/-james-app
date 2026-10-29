/**
 * Isolated offline demonstration data. Every person, source fact, checkpoint,
 * decision and image below is synthetic. Nothing is imported from a live account.
 * These vector scenes are concepts, never photographs or measured plans.
 */
const ACCOUNT_ID = 'demo-account';
const CREATED_AT = '2026-10-12T10:00:00.000Z';
const ASSET_METADATA = {
  "card-back.svg": {
    "sha256": "51e5c1dfc52f3a493f32f90fbb395b72c0e993e782550b179fe1df3800cf6c81",
    "byteSize": 2481
  },
  "card-front.svg": {
    "sha256": "49d74fb291e37a272cc051faa74037040cd2d80813bfacb78653e510a2e23bc4",
    "byteSize": 2205
  },
  "resume-paper.svg": {
    "sha256": "15bb26ba477ddc6250329c51395ecd6714337a9727fbbacab9d3f6f38018e761",
    "byteSize": 2055
  },
  "room-charcoal.svg": {
    "sha256": "fab9a1fde1071ba44c45546c1bee2cee6824373258fccec137745a3f96e493d7",
    "byteSize": 6130
  },
  "room-source.svg": {
    "sha256": "1191793a22fd5ef2231d32d67198ee09475dc17082aca002d62066f5a63a269f",
    "byteSize": 2240
  },
  "room-walnut.svg": {
    "sha256": "3f3cf8267bde55f40d83cd82da340b0b5ceb4f588f58ca495413498d96ef9604",
    "byteSize": 6133
  },
  "visual-study.svg": {
    "sha256": "37f237c76abf9da8457ef193879f1e18f56cf586fb34685b594fe280725f823f",
    "byteSize": 1096
  }
};

function asset(projectId, name, title, origin = 'generated') {
  return {
    id: `${projectId}-asset-${name.replace(/\.svg$/, '')}`,
    accountId: ACCOUNT_ID,
    projectId,
    ...ASSET_METADATA[name],
    mediaType: 'image/svg+xml',
    storageRef: `./assets/${name}`,
    previewRef: `./assets/${name}`,
    originalName: name,
    title,
    origin,
    sourceRefs: [{ type: 'synthetic_fixture', title: 'Created for this offline demonstration', url: null }],
    createdAt: CREATED_AT,
    isSynthetic: true,
    immutable: true,
    provenance: 'Synthetic vector fixture. Not an original user asset or measured plan.'
  };
}
function version(projectId, suffix, title, content, preview, options = {}) {
  return {
    id: `${projectId}-version-${suffix}`,
    artifactId: `${projectId}-artifact-main`,
    projectId,
    parentVersionId: null,
    state: 'draft',
    title,
    label: title,
    content,
    contentRef: null,
    previewRef: preview ? `./assets/${preview}` : null,
    sourceAssetIds: [],
    constraintsSnapshot: [],
    createdAt: CREATED_AT,
    errorCode: null,
    isSynthetic: true,
    ...options
  };
}
function decision(projectId, suffix, text, state = 'proposed') {
  return {
    id: `${projectId}-decision-${suffix}`,
    text,
    source: 'proposal',
    state,
    evidenceRefs: ['synthetic-fixture:demo-only-decision-not-real-user-approval'],
    recordedAt: CREATED_AT,
    supersedesId: null,
    isSynthetic: true
  };
}
function project(id, title, mode, objective, overrides = {}) {
  return {
    schemaVersion: 1,
    id,
    accountId: ACCOUNT_ID,
    title,
    mode,
    objective,
    status: 'active',
    revision: 0,
    createdAt: CREATED_AT,
    updatedAt: '2026-10-15T15:30:00.000Z',
    constraints: [],
    decisions: [],
    ideas: [],
    assetIds: [],
    artifactIds: [],
    selectedArtifactVersionId: null,
    nextAction: '',
    disposition: null,
    checkpoint: null,
    sessionOpen: false,
    needsNextStep: false,
    draftText: '',
    viewState: { tab: 'preview', scrollTop: 0 },
    versions: [],
    assets: [],
    assetImports: [],
    sourceFacts: [],
    previewRef: null,
    isSynthetic: true,
    provenance: 'Offline demonstration only. This does not represent live work or user-provided facts.',
    ...overrides
  };
}
function connectAssets(item) {
  item.assetIds = item.assets.map(entry => entry.id);
  item.artifactIds = [...new Set(item.versions.map(entry => entry.artifactId))];
  item.assetImports = item.assets.map((entry, index) => ({
    id: `${item.id}-import-${index + 1}`,
    assetId: entry.id,
    projectId: item.id,
    originalName: entry.originalName,
    importedAt: CREATED_AT,
    origin: entry.origin,
    sourceRefs: entry.sourceRefs,
    isSynthetic: true
  }));
  return item;
}

/** Returns an independent, mutable set of demo projects on every call. */
export function seedProjects() {
  const roomId = 'demo-room';
  const roomSource = asset(roomId, 'room-source.svg', 'Synthetic source diagram', 'reference');
  const roomConstraints = [
    'Retain the bed, desk and dresser in this synthetic layout.',
    'Modern, sleek and masculine; warm materials and a calm guest experience.',
    'Conceal monitors behind sliding cabinetry when guests stay.',
    'Remove the rolling tray from the proposed layout.',
    'Room dimensions and real furniture measurements are unknown. Concepts are not measured plans.'
  ];
  const room = connectAssets(project(roomId, 'Guest room / office', 'room',
    'Explore a calmer, architectural guest room that still works as an everyday office.', {
      eyebrow: 'A ROOM WITH TWO ROLES',
      summary: 'Warm walnut, quiet lines and a desk that closes away.',
      nextAction: 'Compare the two whole-room palettes and choose a direction.',
      lastCheckpoint: 'Two whole-room concepts are ready to compare. Measurements are still unknown.',
      updatedAt: '2026-10-15T16:40:00.000Z',
      constraints: roomConstraints,
      decisions: [
        decision(roomId, 'keep', 'Keep the bed, desk and dresser in both concepts.', 'accepted'),
        decision(roomId, 'finish', 'Use walnut and linen for a warmer direction.'),
        decision(roomId, 'screen', 'Use sliding fronts to conceal the workstation.')
      ],
      ideas: ['Consider a soft reading light beside the bed.', 'Verify the real room geometry before planning any purchase.'],
      sourceFacts: ['All room images in this demo are synthetic vector illustrations.', 'The source diagram is a fictional reference, not an uploaded photograph.', 'No dimensions, product specifications, or pricing have been verified.'],
      assets: [roomSource, asset(roomId, 'room-walnut.svg', 'Walnut & linen whole-room concept'), asset(roomId, 'room-charcoal.svg', 'Graphite & oak whole-room concept')],
      versions: [
        version(roomId, 'walnut', 'Walnut & linen',
          'SYNTHETIC WHOLE-ROOM CONCEPT A\n\nWarm walnut and soft linen create a calm guest room with an integrated office. Keep the bed, desk and dresser. Place sliding timber fronts across the workstation so monitors can be concealed when guests stay. Remove the rolling tray.\n\nPreserve the source geometry for comparison. The artwork is a concept only: dimensions, clearances, fixtures and products need verification against real room references.',
          'room-walnut.svg', { sourceAssetIds: [roomSource.id], constraintsSnapshot: roomConstraints, createdAt: '2026-10-15T15:45:00.000Z' }),
        version(roomId, 'graphite', 'Graphite & oak',
          'SYNTHETIC WHOLE-ROOM CONCEPT B\n\nA deeper graphite wall and textured neutral bedding give the same room a more tailored feel. Keep the same bed, desk and dresser positions as Concept A so the palette comparison stays clear. Conceal monitors with the same sliding timber fronts and remove the rolling tray.\n\nThis is an alternative finish study using the identical fictional geometry. It is not a measured plan and does not establish real furniture fit.',
          'room-charcoal.svg', { parentVersionId: 'demo-room-version-walnut', sourceAssetIds: [roomSource.id], constraintsSnapshot: roomConstraints, createdAt: '2026-10-15T16:20:00.000Z' })
      ],
      selectedArtifactVersionId: 'demo-room-version-walnut',
      previewRef: './assets/room-walnut.svg',
      draftText: 'Could the desk fronts feel quieter and more integrated with the wall?',
      openQuestions: ['What are the actual room dimensions?', 'Which original furniture must be retained?']
    }));

  const cardId = 'demo-card';
  const card = connectAssets(project(cardId, 'A lasting first impression', 'card',
    'Develop a two-sided leave-behind with restrained navy, ivory and warm metallic accents.', {
      eyebrow: 'LEAVE-BEHIND / FRONT + BACK',
      summary: 'A restrained navy and ivory leave-behind.',
      nextAction: 'Review the front and back, then replace the placeholder copy.',
      lastCheckpoint: 'Front and back layout studies are ready for your review.',
      updatedAt: '2026-10-15T15:55:00.000Z',
      constraints: ['Front and back must work as one system.', 'All copy is placeholder content for this synthetic demo.', 'Finished size, bleed, fonts and image resolution have not been validated. Not print-ready.'],
      decisions: [decision(cardId, 'palette', 'Explore a deep navy front with a warm ivory reverse.', 'accepted'), decision(cardId, 'mark', 'Use a simple geometric placeholder mark until a real logo is supplied.')],
      ideas: ['Try a smaller mark with more breathing room.', 'Confirm a printer and finished size before export.'],
      assets: [asset(cardId, 'card-front.svg', 'Front layout study'), asset(cardId, 'card-back.svg', 'Back layout study')],
      versions: [
        version(cardId, 'front', 'Front · navy',
          '[NAME OR BUSINESS]\n[Short professional description]\n\n[One clear sentence about the service or value offered.]\n\n[Website]  ·  [Contact detail]\n\nDemo copy only. Replace every placeholder before sharing.',
          'card-front.svg', { state: 'ready_for_review', artifactId: 'demo-card-artifact-front', createdAt: '2026-10-15T15:30:00.000Z' }),
        version(cardId, 'back', 'Back · ivory',
          '[A clear, useful headline]\n\n[Two brief sentences describing who this is for and how you can help.]\n\n• [Service or capability one]\n• [Service or capability two]\n• [Service or capability three]\n\n[Email]\n[Phone]\n[Website]\n\nSynthetic layout study. No real contact details are included. Print specifications remain unverified.',
          'card-back.svg', { state: 'ready_for_review', artifactId: 'demo-card-artifact-back', createdAt: '2026-10-15T15:40:00.000Z' })
      ],
      selectedArtifactVersionId: 'demo-card-version-front',
      previewRef: './assets/card-front.svg',
      printSpec: { width: null, height: null, unit: null, bleed: null, fontsValidated: false, resolutionValidated: false, printReady: false },
      openQuestions: ['What is the final copy?', 'What are the finished dimensions and printer requirements?']
    }));

  const resumeId = 'demo-resume';
  const facts = [
    'Synthetic source fact: the fictional candidate coordinates project schedules and meeting follow-ups.',
    'Synthetic source fact: the fictional candidate maintains documentation and shared records.',
    'Synthetic source fact: the fictional candidate prepares status summaries for a team.',
    'Unknown: actual name, employers, dates, job titles, education and credentials.',
    'Unknown: verified results, metrics, awards and years of experience. Do not add them.'
  ];
  const resume = connectAssets(project(resumeId, 'Resume · three directions', 'document',
    'Compare three ways to present the same verified source material without inventing experience.', {
      eyebrow: 'SOURCE FACTS → THREE DRAFTS',
      summary: 'One fact sheet. Three clearly labelled approaches.',
      nextAction: 'Choose a structure and supply the missing employment details.',
      lastCheckpoint: 'Three draft structures use the same synthetic source facts.',
      updatedAt: '2026-10-14T14:10:00.000Z',
      constraints: ['Never invent employers, dates, credentials, accomplishments or metrics.', 'Source facts stay separate from drafted wording.', 'These sample facts describe a fictional candidate, never the user.'],
      sourceFacts: facts,
      decisions: [decision(resumeId, 'facts', 'Keep unknown details as visible placeholders.', 'accepted')],
      ideas: ['Add verified achievements only after the candidate provides evidence.'],
      assets: [asset(resumeId, 'resume-paper.svg', 'Illustrative document structure')],
      versions: [
        version(resumeId, 'direct', '01 · Direct & focused',
          'SYNTHETIC DRAFT 1 — DIRECT & FOCUSED\n\n[CANDIDATE NAME]\n[Contact details]\n\nPROFILE\nProject coordination professional who maintains schedules, follows up on meetings and keeps shared documentation organized. Prepares clear status summaries to help a team understand current work.\n\nEXPERIENCE\n[Verified role] · [Verified employer] · [Verified dates]\n• Coordinated project schedules and meeting follow-ups.\n• Maintained documentation and shared records.\n• Prepared team status summaries.\n\nEDUCATION & CREDENTIALS\n[Add verified information only.]\n\nReview required: this fictional draft contains no verified user experience.',
          'resume-paper.svg', { createdAt: '2026-10-13T10:00:00.000Z' }),
        version(resumeId, 'narrative', '02 · Narrative profile',
          'SYNTHETIC DRAFT 2 — NARRATIVE PROFILE\n\n[CANDIDATE NAME]\n[Contact details]\n\nABOUT\nI help teams keep project work organized by maintaining schedules, following up after meetings and keeping documentation current. I also prepare status summaries that bring the available project information together.\n\nSELECTED EXPERIENCE\n[Verified role, employer and dates]\nProject coordination: schedules and meeting follow-ups.\nDocumentation: shared records and working documents.\nTeam communication: concise status summaries.\n\nEDUCATION\n[Add verified education or omit this section.]\n\nReview required: first-person wording is a proposed style. The underlying source facts remain synthetic.',
          'resume-paper.svg', { parentVersionId: 'demo-resume-version-direct', createdAt: '2026-10-13T10:15:00.000Z' }),
        version(resumeId, 'skills', '03 · Skills-led',
          'SYNTHETIC DRAFT 3 — SKILLS-LED\n\n[CANDIDATE NAME]\n[Contact details]\n\nCORE CAPABILITIES\nProject coordination\nMaintains project schedules and follows up on meeting actions.\n\nDocumentation\nMaintains working documents and shared records.\n\nStatus communication\nPrepares summaries of current project work for a team.\n\nWORK HISTORY\n[Verified role] · [Verified employer] · [Verified dates]\n\nEDUCATION & CREDENTIALS\n[Verified details only; no credentials supplied.]\n\nReview required: this format changes the structure, not the source facts. Replace fictional material with user-supplied facts before use.',
          'resume-paper.svg', { parentVersionId: 'demo-resume-version-direct', createdAt: '2026-10-13T10:30:00.000Z' })
      ],
      selectedArtifactVersionId: 'demo-resume-version-direct',
      previewRef: './assets/resume-paper.svg',
      openQuestions: ['Which role is the real resume targeting?', 'What verified career details can be added?']
    }));

  const waiting = connectAssets(project('demo-waiting', 'The details that make it real', 'general',
    'Collect the original references and measurements needed for a grounded design brief.', {
      status: 'waiting',
      summary: 'A useful brief starts with the right originals.',
      nextAction: 'Add the original photos and confirmed measurements.',
      lastCheckpoint: 'Waiting for source material. No output has been created.',
      updatedAt: '2026-10-13T09:30:00.000Z',
      constraints: ['No actual original files have been supplied.', 'Do not estimate precise measurements from an image.'],
      ideas: ['Capture a whole-room view and each wall from a consistent position.'],
      disposition: { kind: 'waiting', nextAction: 'Add original references and confirmed measurements.', waitingOn: 'Original source files and measurements', requestedAt: '2026-10-13T09:30:00.000Z', dueAt: null, timeZone: 'Etc/UTC', schedulingState: 'not_requested', externalScheduleId: null },
      previewRef: null,
      openQuestions: ['Which source files should be used?']
    }));
  const visualId = 'demo-visual';
  const visual = connectAssets(project(visualId, 'Studies in quiet contrast', 'visual',
    'Explore an architectural palette of deep blue, warm stone and muted brass.', {
      status: 'parked',
      summary: 'An early visual direction, kept for another day.',
      nextAction: 'Return when there is a specific use for this palette.',
      lastCheckpoint: 'One abstract material study preserved. No selection has been approved.',
      updatedAt: '2026-10-12T11:00:00.000Z',
      constraints: ['An exploratory synthetic composition only; no final application chosen.'],
      ideas: ['Consider a more generous ivory margin for an editorial layout.'],
      assets: [asset(visualId, 'visual-study.svg', 'Architectural color study')],
      versions: [version(visualId, 'study', 'Material study', 'SYNTHETIC VISUAL STUDY\n\nDeep navy and muted brass intersect with a warm, stone-colored field. This is a palette and composition exploration. No business identity, product, or user preference is implied.\n\nParked until there is a concrete project to apply it to.', 'visual-study.svg')],
      selectedArtifactVersionId: 'demo-visual-version-study',
      previewRef: './assets/visual-study.svg',
      disposition: { kind: 'parked', nextAction: 'Return when there is a specific use for this palette.', waitingOn: null, requestedAt: '2026-10-12T11:00:00.000Z', dueAt: null, timeZone: 'Etc/UTC', schedulingState: 'not_requested', externalScheduleId: null }
    }));
  return [room, card, resume, waiting, visual];
}
