import { beforeEach,expect,it,vi } from "vitest";
import { fireEvent,screen,waitFor } from "@testing-library/react";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { renderWithI18n } from "../test/i18n";
import { AdminPage } from "./admin-page";

const mocks=vi.hoisted(() => ({access:vi.fn(),services:vi.fn(),activity:vi.fn(),update:vi.fn(),replace:vi.fn(),push:vi.fn(),auth:{user:{id:"user",email:"admin@example.com"},isLoading:false}}));
vi.mock("@auro/core/auth",() => ({useAuthStore:Object.assign((selector: (state: typeof mocks.auth) => unknown) => selector(mocks.auth),{getState:() => mocks.auth})}));
vi.mock("@auro/core/api",async importOriginal => ({...await importOriginal<typeof import("@auro/core/api")>(),api:{getAdminAccess:mocks.access,listAdminMCPServices:mocks.services,getAdminMCPActivity:mocks.activity,updateAdminMCPPolicy:mocks.update,getBaseUrl:() => "https://api.example.invalid"}}));
vi.mock("../navigation",() => ({useNavigation:() => ({replace:mocks.replace,push:mocks.push,getShareableUrl:(path: string) => `https://auro.example.invalid${path}`})}));
const service={id:"auro-tanks",name:"Tank Defense",endpoint:"/api/tanks/mcp",protocolVersion:"2025-11-25",tools:[{name:"tank_save_character",description:"Save a character",inputSchema:{type:"object"},readOnly:false}],policy:{serviceId:"auro-tanks",enabled:true,disabledTools:[],revision:4},stats:{calls:0,errors:0,blocked:0,averageMs:0},toolStats:{}};
function render() {const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});return renderWithI18n(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);}
beforeEach(() => {vi.clearAllMocks();mocks.access.mockResolvedValue({isAdmin:true,configured:true});mocks.services.mockResolvedValue([service]);mocks.activity.mockResolvedValue({items:[]});});
it("does not load global MCP data for a workspace owner without platform authority",async () => {
  mocks.access.mockResolvedValue({isAdmin:false,configured:true});render();
  expect(await screen.findByRole("alert")).toHaveTextContent("Administrator access required");expect(mocks.services).not.toHaveBeenCalled();expect(mocks.activity).not.toHaveBeenCalled();
});
it("preserves a failed policy edit and its original revision for retry",async () => {
  mocks.update.mockRejectedValue(new Error("temporary error"));render();
  const toggle=await screen.findByRole("switch",{name:"Enable tank_save_character"});fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button",{name:"Save policy"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your proposed policy is preserved");expect(toggle).toHaveAttribute("aria-checked","false");
  fireEvent.click(screen.getByRole("button",{name:"Save policy"}));await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
  expect(mocks.update.mock.calls[0]![1]).toEqual({enabled:true,disabledTools:["tank_save_character"],expectedRevision:4});expect(mocks.update.mock.calls[1]![1]).toEqual(mocks.update.mock.calls[0]![1]);
});
it("shows the registered schema for review without executing the tool",async () => {
  render();fireEvent.click(await screen.findByRole("button",{name:"View tank_save_character schema"}));
  expect(screen.getByRole("dialog")).toHaveTextContent('"type": "object"');expect(mocks.update).not.toHaveBeenCalled();
});
