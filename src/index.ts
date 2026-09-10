import {openapi} from "@elysia/openapi"
import { Elysia } from "elysia";

const app = new Elysia().get("/", () => "Hello Elysia").listen(3000);

app.use(openapi())
