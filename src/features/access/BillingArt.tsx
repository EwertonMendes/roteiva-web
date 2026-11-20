
import type {PlanCode} from "./billing-data";

export function BillingArt({name,priority=false}:{name:"access"|PlanCode;priority?:boolean}) {
  return <img className="billing-art" src={`${import.meta.env.BASE_URL}brand/billing/${name}.webp`}
    alt="" aria-hidden="true" loading={priority?"eager":"lazy"} decoding="async"/>;
}
