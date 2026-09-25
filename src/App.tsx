import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TooltipProvider } from '@/components/ui/tooltip'

export function App() {
  return (
    <TooltipProvider>
      <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>NetworkStudy</CardTitle>
            <CardDescription>Hello, network!</CardDescription>
          </CardHeader>
          <CardContent>
            <Button>Get started</Button>
          </CardContent>
        </Card>
      </main>
    </TooltipProvider>
  )
}
