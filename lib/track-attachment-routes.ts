import { attachmentRoutes } from './file-attachments';
import { realUserId } from './session';
import { createIssueAttachment, getAccessibleIssue, getIssueAttachmentFile, type TrackIssueAttachmentWithAuthor } from './track-data';
import { trackFiles } from './track-files';

/**
 * Rutas de adjuntos de un issue (/api/track/issues/[id]/attachments/upload,
 * /finalize y /[fileId]). El issue tiene que ser visible para la sesión
 * (getAccessibleIssue chequea el workspace y el acceso al team); el id que
 * se usa después es el del issue encontrado, no el del pedido.
 */
export const trackAttachmentRoutes = attachmentRoutes<TrackIssueAttachmentWithAuthor>({
  files: trackFiles,
  authorize: async ({ user, params }) => {
    if (!params.id) return null;
    const found = await getAccessibleIssue(params.id, user.team?.id ?? null, user.id);
    return found?.issue.id ?? null;
  },
  save: ({ user, recordId, file }) =>
    createIssueAttachment(recordId, realUserId(user), {
      filename: file.filename,
      contentType: file.contentType,
      size: file.size,
      url: file.ref,
    }),
  find: ({ recordId, fileId }) => getIssueAttachmentFile(fileId, recordId),
});
