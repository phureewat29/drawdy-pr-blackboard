/** The parser worker's script: `npm run worker` bundles this and what it imports into `script.ts`. */

import { serve, type WorkerScope } from "./serve.ts";

serve(self as unknown as WorkerScope);
