const PROJECT_PREFIX = 'roomify_project_';
const PUBLIC_PREFIX = 'roomify_public_';

const jsonError = (status, message, extra = {}) => {
    return new Response(JSON.stringify({  error: message, ...extra }), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
    })
}

const getUserId = async (userPuter) => {
    try {
        const user = await userPuter.auth.getUser();

        return user?.uuid || null;
    } catch {
        return null;
    }
}

router.post('/api/projects/save', async ({ request, user }) => {
    try {
        const userPuter = user.puter;

        if(!userPuter) return jsonError(401, 'Authentication failed');

        const body = await request.json();
        const project = body?.project;

        if(!project?.id || !project?.sourceImage) return jsonError(400, 'Project ID and source image are required');

        const payload = {
            ...project,
            updatedAt: new Date().toISOString(),
        }

        const userId = await getUserId(userPuter);
        if(!userId) return jsonError(401, 'Authentication failed');

        const key = `${PROJECT_PREFIX}${project.id}`;
        await userPuter.kv.set(key, payload);

        return { saved: true, id: project.id, project: payload }
    } catch (e) {
        return jsonError(500, 'Failed to save project', { message: e.message || 'Unknown error' });
    }
})

router.get('/api/projects/list', async ({ user }) => {
    try {
        const userPuter = user.puter;
        if (!userPuter) return jsonError(401, 'Authentication failed');

        const userId = await getUserId(userPuter);
        if (!userId) return jsonError(401, 'Authentication failed');

        const projects = (await userPuter.kv.list(PROJECT_PREFIX, true))
            .map(({value}) => ({ ...value, isPublic: true }))

        return { projects };
    } catch (e) {
        return jsonError(500, 'Failed to list projects', { message: e.message || 'Unknown error' });
    }
})

router.get('/api/projects/get', async ({ request, user }) => {
    try {
        const userPuter = user.puter;
        if (!userPuter) return jsonError(401, 'Authentication failed');

        const userId = await getUserId(userPuter);
        if (!userId) return jsonError(401, 'Authentication failed');

        const url = new URL(request.url);
        const id = url.searchParams.get('id');

        if (!id) return jsonError(400, 'Project ID is required');

        const key = `${PROJECT_PREFIX}${id}`;
        const project = await userPuter.kv.get(key);

        if (!project) return jsonError(404, 'Project not found');

        return { project };
    } catch (e) {
        return jsonError(500, 'Failed to get project', { message: e.message || 'Unknown error' });
    }
})

router.post('/api/projects/share', async ({ request, user }) => {
    try {
        const userPuter = user.puter;
        if (!userPuter) return jsonError(401, 'Authentication failed');

        const userId = await getUserId(userPuter);
        if (!userId) return jsonError(401, 'Authentication failed');

        const body = await request.json();
        const { projectId } = body;
        if (!projectId) return jsonError(400, 'Project ID is required');

        // Get project from private storage
        const privateKey = `${PROJECT_PREFIX}${projectId}`;
        const project = await userPuter.kv.get(privateKey);
        if (!project) return jsonError(404, 'Project not found');

        // Get user info for metadata
        const userInfo = await userPuter.auth.getUser();
        const userName = userInfo?.username || 'Unknown';

        // Add metadata and move to public storage
        const publicProject = {
            ...project,
            ownerId: userId,
            sharedBy: userName,
            sharedAt: new Date().toISOString(),
            isPublic: true,
        };

        const publicKey = `${PUBLIC_PREFIX}${projectId}`;
        await userPuter.kv.set(publicKey, publicProject);

        // Remove from private storage
        await userPuter.kv.delete(privateKey);

        return new Response(JSON.stringify({ shared: true, projectId, project: publicProject }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        })
    } catch (e) {
        return jsonError(500, 'Failed to share project', { message: e.message || 'Unknown error' });
    }
})

router.post('/api/projects/unshare', async ({ request, user }) => {
    try {
        const userPuter = user.puter;
        if (!userPuter) return jsonError(401, 'Authentication failed');

        const userId = await getUserId(userPuter);
        if (!userId) return jsonError(401, 'Authentication failed');

        const body = await request.json();
        const { projectId } = body;
        if (!projectId) return jsonError(400, 'Project ID is required');

        // Get project from public storage
        const publicKey = `${PUBLIC_PREFIX}${projectId}`;
        const project = await userPuter.kv.get(publicKey);
        if (!project) return jsonError(404, 'Project not found in public storage');

        // Verify ownership
        if (project.ownerId !== userId) return jsonError(403, 'Not authorized to unshare this project');

        // Remove metadata and move back to private storage
        const privateProject = {
            ...project,
            isPublic: false,
        };
        delete privateProject.sharedBy;
        delete privateProject.sharedAt;

        const privateKey = `${PROJECT_PREFIX}${projectId}`;
        await userPuter.kv.set(privateKey, privateProject);

        // Remove from public storage
        await userPuter.kv.delete(publicKey);

        return new Response(JSON.stringify({ unshared: true, projectId, project: privateProject }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        })
    } catch (e) {
        return jsonError(500, 'Failed to unshare project', { message: e.message || 'Unknown error' });
    }
})