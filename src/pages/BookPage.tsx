import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthProvider'
import { useAsync } from '../lib/useAsync'
import { getBook } from '../services/books'
import { EmptyState, ErrorBox, Spinner } from '../components/ui/States'
import BookEntry from './BookEntry'
import BookPageView from './BookPageView'

/**
 * Eine Buchseite: Eigene Bücher (und öffentliche Bücher für Mods/Admins) öffnen die Eingabetabelle,
 * alle anderen sehen öffentliche Bücher schreibgeschützt (mit "Prüfung anfordern").
 */
export default function BookPage() {
  const { bookId = '' } = useParams()
  const { isStaff, profileReady } = useAuth()
  const book = useAsync(() => getBook(bookId), [bookId])

  if ((book.loading && !book.data) || !profileReady) return <Spinner />
  if (book.error) return <ErrorBox message={book.error} onRetry={book.reload} />
  if (!book.data) return <EmptyState title="Buch nicht gefunden" action={<Link to="/buecher" className="btn-primary">Zu den Büchern</Link>} />
  if (book.data.is_public && !isStaff) return <BookPageView bookId={bookId} bookName={book.data.name} />
  return <BookEntry />
}
