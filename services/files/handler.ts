import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Routes, badRequest, dispatch, forbidden } from '../shared/http';
import { uuid } from '../shared/util';

/** Files live in one bucket under t/<tenant>/<uuid>/<file name>. Items elsewhere store only { key, name }. */
const s3 = new S3Client({});
const bucket = () => process.env.FILES_BUCKET!;
const MAX_NAME = 120;

export function safeName(name: string): string {
  const cleaned = name.replace(/[^\w.\- ]+/g, '_').trim().slice(-MAX_NAME);
  return cleaned || 'file';
}

export const routes: Routes = {
  'POST /files/upload-url': async (req) => {
    const fileName = String(req.body.fileName ?? '');
    if (!fileName) throw badRequest('fileName is required');
    const name = safeName(fileName);
    const key = `t/${req.auth.tenant}/${uuid()}/${name}`;
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: req.body.contentType || 'application/octet-stream' }),
      { expiresIn: 300 },
    );
    return { key, name, url };
  },

  'GET /files/download-url': async (req) => {
    const key = String(req.query.key ?? '');
    if (!key.startsWith(`t/${req.auth.tenant}/`)) throw forbidden('No access to this file');
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: 300 });
    return { url };
  },
};

export const handler = async (event: any) => dispatch(routes, event);
