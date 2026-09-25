import { createApi } from '../../../api/client'

// Drafting's endpoints live under /api/drafting/ on the AMS backend (merge phase 01),
// on the same authenticated client as the rest of AMS.
const api = createApi('/api/drafting')

export default api
