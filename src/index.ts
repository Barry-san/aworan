import {openapi} from "@elysia/openapi"
import { Elysia } from "elysia";
import { videoRoutes } from "./features/videos";

const app = new Elysia().get("/", () => "Hello Elysia").listen(3000);

app.use(openapi())
app.use(videoRoutes)
