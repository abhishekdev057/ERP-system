import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { Trash2, UserCog, Building2, ShieldAlert, Key } from "lucide-react";
import { RoleSelect, DeleteButton, UserCreationForm } from "./client-actions";
import UserAvatar from "@/components/ui/UserAvatar";

type AdminUsersPageProps = {
    searchParams?: {
        error?: string | string[];
    };
};

function getFirstQueryValue(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
}

function buildCreateUserErrorMessage(errorCode?: string) {
    switch (errorCode) {
        case "email-exists":
            return "A user with this email already exists. Use a different email or edit the existing account.";
        case "username-exists":
            return "This username is already in use for the selected institute. Choose a different username.";
        default:
            return "";
    }
}

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
    const session = await getServerSession(authOptions);

    if (session?.user?.role !== "SYSTEM_ADMIN") {
        redirect("/");
    }

    const createUserError = buildCreateUserErrorMessage(
        getFirstQueryValue(searchParams?.error)
    );

    const users = await prisma.user.findMany({
        include: {
            organization: {
                select: { name: true }
            }
        },
        orderBy: { createdAt: "desc" }
    });

    const organizations = await prisma.organization.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" }
    });

    async function deleteUser(formData: FormData) {
        "use server";
        const userId = formData.get("userId") as string;

        // Prevent deleting yourself
        const session = await getServerSession(authOptions);
        if (session?.user?.id === userId) return;

        await prisma.user.delete({
            where: { id: userId }
        });

        revalidatePath("/admin/users");
    }

    async function changeUserRole(formData: FormData) {
        "use server";
        const userId = formData.get("userId") as string;
        const role = formData.get("role") as "SYSTEM_ADMIN" | "ORG_ADMIN" | "MEMBER";

        // Prevent downgrading yourself
        const session = await getServerSession(authOptions);
        if (session?.user?.id === userId && role !== "SYSTEM_ADMIN") return;

        await prisma.user.update({
            where: { id: userId },
            data: { role }
        });

        revalidatePath("/admin/users");
    }

    async function createUser(formData: FormData) {
        "use server";
        const emailInput = (formData.get("email") as string | null)?.trim() || null;
        const email = emailInput ? emailInput.toLowerCase() : null;
        const orgId = (formData.get("orgId") as string)?.trim();
        const name = (formData.get("name") as string)?.trim();
        const username = (formData.get("username") as string)?.trim();
        const rawPassword = (formData.get("password") as string)?.trim();
        const role = formData.get("role") as "SYSTEM_ADMIN" | "ORG_ADMIN" | "MEMBER";

        // Must have at least an email or (orgId + username + password)
        if (!email && (!orgId || !username || !rawPassword)) return;

        if (email) {
            const existingUser = await prisma.user.findUnique({
                where: { email },
                select: { id: true },
            });
            if (existingUser) {
                redirect("/admin/users?error=email-exists");
            }
        } else if (orgId && username) {
            const existingUser = await prisma.user.findFirst({
                where: {
                    organizationId: orgId,
                    username,
                },
                select: { id: true },
            });
            if (existingUser) {
                redirect("/admin/users?error=username-exists");
            }
        }

        let data: any = {
            role: role || "MEMBER",
            name: name || undefined,
        };

        if (email) {
            data.email = email;
            if (orgId) data.organizationId = orgId;
        } else {
            const hashedPassword = await bcrypt.hash(rawPassword, 10);
            data = {
                ...data,
                organizationId: orgId,
                username,
                password: hashedPassword,
                visiblePassword: rawPassword // Visible only to admin
            };
        }

        try {
            await prisma.user.create({ data });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                const target = Array.isArray(error.meta?.target) ? error.meta?.target : [];
                if (target.includes("email")) {
                    redirect("/admin/users?error=email-exists");
                }
                if (target.includes("organizationId") || target.includes("username")) {
                    redirect("/admin/users?error=username-exists");
                }
                redirect("/admin/users?error=email-exists");
            }
            throw error;
        }

        revalidatePath("/admin/users");
    }

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
                <UserCog className="w-8 h-8 text-blue-600" /> User Management
            </h1>
            <p className="mt-2 text-sm text-slate-500">View and manage all registered users across the platform. You can configure users via Emails (for Google Login) or Auto-Credentials (for Org IDs).</p>

            <div className="mt-8">
                {createUserError ? (
                    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
                        {createUserError}
                    </div>
                ) : null}
                <UserCreationForm organizations={organizations} action={createUser} />
            </div>

            <div className="mt-12 bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 overflow-hidden">
                <div className="px-6 py-5 border-b border-slate-200 bg-slate-50">
                    <h3 className="text-base font-semibold text-slate-900">Total System Users ({users.length})</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50">
                            <tr>
                                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">User</th>
                                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Institute</th>
                                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Credentials</th>
                                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Role</th>
                                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Joined</th>
                                <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200">
                            {users.map((user) => {
                                const isSelf = session?.user?.id === user.id;

                                return (
                                    <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center">
                                                <UserAvatar
                                                    src={user.image}
                                                    name={user.name}
                                                    email={user.email || user.username}
                                                    sizeClass="h-10 w-10"
                                                    className="border border-slate-200 flex-shrink-0"
                                                />
                                                <div className="ml-4">
                                                    <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                                        {user.name || "No Name"}
                                                        {isSelf && <span className="px-2 pl-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold uppercase tracking-wider">You</span>}
                                                    </div>
                                                    <div className="text-sm text-slate-500">{user.email || user.username}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {user.organization ? (
                                                <div className="flex flex-col gap-1">
                                                    <span className="flex items-center gap-2 text-sm text-slate-700 font-semibold">
                                                        <Building2 className="w-4 h-4 text-slate-400" />
                                                        {user.organization.name}
                                                    </span>
                                                    <span className="text-xs text-slate-500 font-mono pl-6">ID: {user.organizationId}</span>
                                                </div>
                                            ) : (
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
                                                    No Institute
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {user.visiblePassword ? (
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-xs font-mono bg-slate-100 text-slate-700 px-2 py-1 rounded inline-block w-fit">
                                                        User: {user.username}
                                                    </span>
                                                    <span className="text-xs font-mono bg-blue-50 text-blue-700 px-2 py-1 rounded flex items-center gap-1 w-fit">
                                                        <Key className="w-3 h-3" /> {user.visiblePassword}
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-slate-500 italic">Google Auth Only</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <form action={changeUserRole}>
                                                <input type="hidden" name="userId" value={user.id} />
                                                <RoleSelect role={user.role} isSelf={isSelf} />
                                            </form>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                                            {new Date(user.createdAt).toLocaleDateString("en-IN")}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            {!isSelf ? (
                                                <form action={deleteUser} className="inline-block">
                                                    <input type="hidden" name="userId" value={user.id} />
                                                    <DeleteButton userName={user.name || user.email || "this user"} />
                                                </form>
                                            ) : (
                                                <div className="inline-flex p-2 group" title="Cannot delete yourself">
                                                    <ShieldAlert className="w-4 h-4 text-slate-300 group-hover:text-slate-400 transition-colors" />
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    {users.length === 0 && (
                        <div className="p-12 text-center text-slate-500">
                            No users found in the system.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
