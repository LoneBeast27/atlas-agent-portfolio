import { Hono } from 'hono';
import { config, apiFetch } from '../lib/clients';

const app = new Hono();

interface QdrantCollection {
  name: string;
  status: string;
  points_count: number;
  segments_count: number;
  vectors_count: number;
}

interface QdrantCollectionsResponse {
  result: { collections: Array<{ name: string }> };
}

interface QdrantCollectionInfo {
  result: {
    status: string;
    points_count: number;
    segments_count: number;
    vectors_count: number;
  };
}

const qdrantHeaders = () => ({ 'api-key': config.qdrant.apiKey });

app.get('/stats', async (c) => {
  try {
    const list = await apiFetch<QdrantCollectionsResponse>(
      `${config.qdrant.url}/collections`, { headers: qdrantHeaders() }
    );

    const collections = await Promise.all(
      (list.result?.collections ?? []).map(async (col) => {
        try {
          const info = await apiFetch<QdrantCollectionInfo>(
            `${config.qdrant.url}/collections/${col.name}`, { headers: qdrantHeaders() }
          );
          return {
            name: col.name,
            status: info.result.status,
            vectors: info.result.vectors_count ?? info.result.points_count ?? 0,
            segments: info.result.segments_count ?? 0,
          };
        } catch {
          return { name: col.name, status: 'error', vectors: 0, segments: 0 };
        }
      })
    );

    const totalVectors = collections.reduce((sum, c) => sum + c.vectors, 0);

    return c.json({
      collections,
      total_vectors: totalVectors,
      collection_count: collections.length,
    });
  } catch (err) {
    return c.json({ error: 'Failed to reach Qdrant', detail: String(err) }, 502);
  }
});

export default app;
