import { redirect } from 'next/navigation'
import { v4 as uuidv4 } from 'uuid'

// Force dynamic rendering to generate a new UUID on every request
export const dynamic = 'force-dynamic'

export default function Home() {
  redirect(`/room/${uuidv4()}`)
}
