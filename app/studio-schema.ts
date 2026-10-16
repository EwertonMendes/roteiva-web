import { validTimeRange } from "./studio-calendar";
import { z } from "zod";
const id = z.number().finite();
const text = z.string().max(10000);
const project = z.object({id, name:text, client:text, status:z.enum(["Em produção","Em aprovação","Ajustes","Aprovado"]), due:text, progress:z.number().min(0).max(100), files:z.number().nonnegative(), color:text, initials:text}).passthrough();
const client = z.object({id,name:text,contact:text,type:z.enum(["Recorrente","Avulso"])}).passthrough();
const finance = z.object({id,project:text,client:text,amount:z.number().positive().max(1e12),date:z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),status:z.enum(["Recebido","A receber"]),kind:z.enum(["income","expense"]).optional()}).passthrough();
export const workspaceSchema = z.object({projects:z.array(project).max(20000),clients:z.array(client).max(20000),financeEntries:z.array(finance).max(50000),calendarEvents:z.array(z.object({id,title:text,date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),time:z.string(),endTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),type:text,client:text}).passthrough().refine(e=>!e.endTime || validTimeRange(e.time,e.endTime), {message:"Intervalo de horário inválido",path:["endTime"]})).max(20000),libraryAssets:z.array(z.object({id,name:text,kind:text,size:text,addedAt:text,project:text,color:text}).passthrough()).max(20000)}).passthrough();
