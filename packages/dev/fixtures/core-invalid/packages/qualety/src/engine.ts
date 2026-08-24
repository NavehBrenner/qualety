import { spawn } from "node:child_process";
import { scan } from "dupehound";
import { Project } from "ts-morph";

const env = process.env.QUALETY_DUPEHOUND;
spawn("dupehound", ["scan"]);
void Project;
void scan;
void env;
